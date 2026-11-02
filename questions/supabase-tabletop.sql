-- Idempotent upgrade for the compact card drawer. Preserve questions/settings/IDs.
begin;
alter table public.question_decks add column if not exists table_state jsonb not null default '{"play":"single","card":null,"history":[],"last":null}';
alter table public.question_decks alter column table_state set default '{"play":"single","card":null,"history":[],"last":null}';
create or replace function question_private.deck_json(d public.question_decks)
returns jsonb language sql immutable set search_path = '' as $$
 select jsonb_build_object('questions',d.questions,'items',(select jsonb_agg(jsonb_build_object('text',q.value #>> '{}') || (d.question_meta -> (q.ordinality-1)::integer) order by q.ordinality) from jsonb_array_elements(d.questions) with ordinality q),
 'remaining',to_jsonb(d.remaining),'settings',d.settings,'current',d.current,'revealed',d.revealed,'revision',d.revision,'last_action',d.last_action,'updated_at',d.updated_at,'table',d.table_state);
$$;
update public.question_decks d set table_state=jsonb_build_object(
 'play',case when table_state->>'play'='individual' then 'multiple' else 'single' end,
 'card',(select value from jsonb_array_elements(coalesce(d.table_state->'cards','[]')) where jsonb_typeof(value)='number' limit 1),
 'last',(select value from jsonb_array_elements(coalesce(d.table_state->'cards','[]')) where jsonb_typeof(value)='number' limit 1),
 'history',case when table_state->>'play'='individual' then coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(d.table_state->'cards','[]')) where jsonb_typeof(value)='number'),'[]') else '[]'::jsonb end),revision=revision+1
 where not(table_state ? 'card');
create or replace function question_private.reset_table_questions() returns trigger language plpgsql set search_path='' as $$
begin
 if new.questions is distinct from old.questions then new.table_state := '{"play":"single","card":null,"history":[],"last":null}'; end if;
 return new;
end; $$;
revoke all on function question_private.reset_table_questions() from public,anon,authenticated;
drop trigger if exists reset_question_table on public.question_decks;
create trigger reset_question_table before update of questions on public.question_decks for each row execute function question_private.reset_table_questions();
create or replace function public.change_question_table(p_id uuid,p_revision bigint,p_action text,p_slot integer default 0,p_play text default null,p_players integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.question_decks; t jsonb; chosen integer; pool integer[]; fresh boolean; previous integer;
begin
 if question_private.request_deck_id() is distinct from p_id::text then return null; end if;
 select * into d from public.question_decks where id=p_id for update;
 if not found then return null; end if;
 if p_revision is null or p_revision <> d.revision then return jsonb_build_object('status','conflict','deck',question_private.deck_json(d)); end if;
 t:=d.table_state;
 if p_action='configure' then
  if p_play is null or p_play not in ('single','multiple') then raise exception 'Invalid draw mode'; end if;
  t:=jsonb_build_object('play',p_play,'card',null,'last',t->'last','history','[]'::jsonb);
 elsif p_action='draw' then
  if p_slot is distinct from 0 then raise exception 'Invalid slot'; end if;
  if t->>'card' is not null then t:=jsonb_set(t,'{card}','null');
  else
   pool:=d.remaining; fresh:=cardinality(pool)=0; previous:=(t->>'last')::integer;
   if fresh then pool:=array(select generate_series(0,jsonb_array_length(d.questions)-1));t:=jsonb_set(t,'{history}','[]');end if;
   select i into chosen from unnest(pool) i where not fresh or cardinality(pool)=1 or previous is null or i<>previous order by random() limit 1;
   if chosen is null then raise exception 'No questions';end if;
   t:=t||jsonb_build_object('card',chosen,'last',chosen);
   if t->>'play'='multiple' then t:=jsonb_set(t,'{history}',(t->'history')||jsonb_build_array(chosen));end if;
   d.remaining:=array_remove(pool,chosen); d.current:=chosen;d.revealed:=true;
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
