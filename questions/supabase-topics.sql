-- Apply after supabase-tabletop.sql. Preserve question IDs, text and timestamps.
begin;
create or replace function public.change_question_deck(
  p_id uuid, p_revision bigint, p_action text,
  p_questions jsonb default null, p_reveal boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.question_decks;
  q jsonb;
  picked integer;
  previous integer;
  new_round boolean;
  total integer;
  next_questions jsonb := '[]'::jsonb;
  next_meta jsonb := '[]'::jsonb;
  meta jsonb;
begin
  if question_private.request_deck_id() is distinct from p_id::text then return null; end if;
  -- Serialize operations on the same deck. A stale device receives the latest state
  -- rather than overwriting newer changes or drawing/opening a different question.
  select * into d from public.question_decks where id = p_id for update;
  if not found then return null; end if;
  if p_revision is null or p_revision <> d.revision then
    return jsonb_build_object('status', 'conflict', 'deck', question_private.deck_json(d));
  end if;

  if p_action = 'edit' then
    if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'Invalid questions'; end if;
    total := jsonb_array_length(p_questions);
    if total < 1 or total > 500 or octet_length(p_questions::text) > 2097152 then raise exception 'Invalid question count'; end if;
    for q in select value from jsonb_array_elements(p_questions) loop
      if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q -> 'text') is distinct from 'string'
        or char_length(btrim(q ->> 'text')) < 1 or char_length(q ->> 'text') > 500 then
        raise exception 'Invalid question';
      end if;
      meta := null;
      if nullif(q ->> 'id', '') is not null then
        select value into meta from jsonb_array_elements(d.question_meta) where value ->> 'id' = q ->> 'id';
        if meta is null then raise exception 'Unknown question ID'; end if;
      end if;
      if meta is null then meta := jsonb_build_object('id', gen_random_uuid(), 'created_at', now()); end if;
      next_questions := next_questions || jsonb_build_array(btrim(q ->> 'text'));
      if q ? 'topic' then
        if jsonb_typeof(q->'topic') is distinct from 'string' or char_length(q->>'topic') > 30 then raise exception 'Invalid topic'; end if;
        meta := meta || jsonb_build_object('topic',btrim(q->>'topic'));
      end if;
      next_meta := next_meta || jsonb_build_array(meta);
    end loop;
    if (select count(distinct value) from jsonb_array_elements(next_questions)) <> total then raise exception 'Duplicate questions'; end if;
    if (select count(distinct value ->> 'id') from jsonb_array_elements(next_meta)) <> total then raise exception 'Duplicate question ID'; end if;
    d.questions := next_questions;
    d.question_meta := next_meta;
    d.remaining := array(select generate_series(0, total - 1));
    d.current := null;
    d.revealed := false;
  elsif p_action = 'draw' then
    if d.current is not null and not d.revealed then
      return jsonb_build_object('status', 'conflict', 'deck', question_private.deck_json(d));
    end if;
    total := jsonb_array_length(d.questions);
    previous := d.current;
    new_round := cardinality(d.remaining) = 0;
    if new_round then d.remaining := array(select generate_series(0, total - 1)); end if;
    select n into picked from unnest(d.remaining) as n
      where not new_round or total = 1 or previous is null or n <> previous
      order by random() limit 1;
    if picked is null then raise exception 'Invalid deck state'; end if;
    d.current := picked;
    d.remaining := array_remove(d.remaining, picked);
    d.revealed := coalesce(p_reveal, false);
  elsif p_action = 'reveal' then
    if d.current is null then raise exception 'No question has been drawn'; end if;
    d.revealed := true;
  else
    raise exception 'Invalid action';
  end if;

  update public.question_decks set questions = d.questions, question_meta = d.question_meta, remaining = d.remaining,
    current = d.current, revealed = d.revealed, revision = d.revision + 1,
    last_action = p_action, updated_at = now()
    where id = p_id returning * into d;
  -- Only broadcast a wake-up hint. Clients fetch authoritative state through RPC;
  -- an untrusted client broadcast can never supply questions or change progress.
  perform realtime.send(jsonb_build_object('revision', d.revision),
    'deck_updated', 'question-deck:' || p_id::text, false);
  return jsonb_build_object('status', 'ok', 'deck', question_private.deck_json(d));
end;
$$;

create or replace function question_private.reset_table_questions() returns trigger language plpgsql set search_path='' as $$
begin
 if (select count(distinct nullif(nullif(m->>'topic',''),'未分类')) from jsonb_array_elements(new.question_meta) m) > greatest(6,(select count(distinct nullif(nullif(m->>'topic',''),'未分类')) from jsonb_array_elements(old.question_meta) m)) then raise exception 'Too many topics'; end if;
 if new.questions is distinct from old.questions or new.question_meta is distinct from old.question_meta then
 new.table_state := jsonb_build_object('play',coalesce(old.table_state->>'play','single'),'topic','','card',null,'history','[]'::jsonb,'last',null);
 end if;
 return new;
end; $$;
drop trigger if exists reset_question_table on public.question_decks;
create trigger reset_question_table before update of questions,question_meta on public.question_decks for each row execute function question_private.reset_table_questions();
create or replace function public.change_question_table(p_id uuid,p_revision bigint,p_action text,p_slot integer default 0,p_play text default null,p_players integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.question_decks; t jsonb; chosen integer; pool integer[]; fresh boolean; previous integer; topic text; eligible integer[];
begin
 if question_private.request_deck_id() is distinct from p_id::text then return null; end if;
 select * into d from public.question_decks where id=p_id for update;
 if not found then return null; end if;
 if p_revision is null or p_revision <> d.revision then return jsonb_build_object('status','conflict','deck',question_private.deck_json(d)); end if;
 t:=d.table_state; topic:=coalesce(t->>'topic','');
 eligible:=array(select i from generate_series(0,jsonb_array_length(d.questions)-1) i where topic='' or coalesce(nullif(d.question_meta->i->>'topic',''),'未分类')=topic);
 if p_action='configure' then
  if p_play is null or p_play not in ('single','multiple') then raise exception 'Invalid draw mode'; end if;
  t:=jsonb_build_object('play',p_play,'card',null,'last',t->'last','history','[]'::jsonb,'topic',topic);
 elsif p_action='topic' then
  if p_play is null or char_length(p_play)>30 then raise exception 'Invalid topic'; end if;
  if p_play<>'' and not exists(select 1 from jsonb_array_elements(d.question_meta) m where coalesce(nullif(m->>'topic',''),'未分类')=p_play) then raise exception 'Unknown topic'; end if;
  t:=jsonb_build_object('play',t->>'play','topic',p_play,'card',null,'last',null,'history','[]'::jsonb);
  d.remaining:=array(select generate_series(0,jsonb_array_length(d.questions)-1));d.current:=null;d.revealed:=false;
 elsif p_action='draw' then
  if p_slot is distinct from 0 then raise exception 'Invalid slot'; end if;
  if t->>'card' is not null then t:=jsonb_set(t,'{card}','null');
  else
   pool:=array(select i from unnest(d.remaining) i where i=any(eligible)); fresh:=cardinality(pool)=0; previous:=(t->>'last')::integer;
   if fresh then pool:=eligible;d.remaining:=array(select generate_series(0,jsonb_array_length(d.questions)-1));t:=jsonb_set(t,'{history}','[]');end if;
   select i into chosen from unnest(pool) i where not fresh or cardinality(pool)=1 or previous is null or i<>previous order by random() limit 1;
   if chosen is null then raise exception 'No questions';end if;
   t:=t||jsonb_build_object('card',chosen,'last',chosen);
   if t->>'play'='multiple' then t:=jsonb_set(t,'{history}',(t->'history')||jsonb_build_array(chosen));end if;
   d.remaining:=array_remove(d.remaining,chosen); d.current:=chosen;d.revealed:=true;
  end if;
 else raise exception 'Invalid action';end if;
 update public.question_decks set table_state=t,remaining=d.remaining,current=d.current,revealed=d.revealed,revision=d.revision+1,last_action='table',updated_at=now() where id=p_id returning * into d;
 perform realtime.send(jsonb_build_object('revision',d.revision),'deck_updated','question-deck:'||p_id::text,false);
 return jsonb_build_object('status','ok','deck',question_private.deck_json(d));
end; $$;
revoke all on function public.change_question_table(uuid,bigint,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.change_question_table(uuid,bigint,text,integer,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
