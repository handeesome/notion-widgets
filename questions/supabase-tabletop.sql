-- Run after supabase-setup.sql. Existing questions/settings are preserved.
begin;
alter table public.question_decks add column if not exists table_state jsonb not null default '{"play":"shared","players":2,"turn":0,"cards":[null,null,null]}';
create or replace function question_private.deck_json(d public.question_decks)
returns jsonb language sql immutable set search_path = '' as $$
 select jsonb_build_object('questions',d.questions,'items',(select jsonb_agg(jsonb_build_object('text',q.value #>> '{}') || (d.question_meta -> (q.ordinality-1)::integer) order by q.ordinality) from jsonb_array_elements(d.questions) with ordinality q),
 'remaining',to_jsonb(d.remaining),'settings',d.settings,'current',d.current,'revealed',d.revealed,'revision',d.revision,'last_action',d.last_action,'updated_at',d.updated_at,'table',d.table_state);
$$;
create or replace function question_private.reset_table_questions() returns trigger language plpgsql set search_path='' as $$
begin
 if new.questions is distinct from old.questions then new.table_state := '{"play":"shared","players":2,"turn":0,"cards":[null,null,null]}'; end if;
 return new;
end; $$;
revoke all on function question_private.reset_table_questions() from public,anon,authenticated;
drop trigger if exists reset_question_table on public.question_decks;
create trigger reset_question_table before update of questions on public.question_decks for each row execute function question_private.reset_table_questions();
create or replace function public.change_question_table(p_id uuid,p_revision bigint,p_action text,p_slot integer default 0,p_play text default null,p_players integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.question_decks; t jsonb; cards jsonb; chosen integer; occupied integer[]; pool integer[]; n integer;
begin
 if question_private.request_deck_id() is distinct from p_id::text then return null; end if;
 select * into d from public.question_decks where id=p_id for update;
 if not found then return null; end if;
 if p_revision is null or p_revision <> d.revision then return jsonb_build_object('status','conflict','deck',question_private.deck_json(d)); end if;
 t:=d.table_state; cards:=t->'cards';
 if p_action='configure' then
  if p_play is null or p_play not in ('shared','individual') or p_players is null or p_players not in (2,3) then raise exception 'Invalid table configuration'; end if;
  t:=jsonb_build_object('play',p_play,'players',p_players,'turn',0,'cards','[null,null,null]'::jsonb);
 elsif p_action='turn' then t:=jsonb_set(t,'{turn}',to_jsonb(((t->>'turn')::int+1) % (t->>'players')::int));
 elsif p_action='reset' then t:=t||'{"turn":0,"cards":[null,null,null]}'::jsonb;
 elsif p_action='draw' then
  n:=case when t->>'play'='shared' then 1 else (t->>'players')::int end;
  if p_slot is null or p_slot < 0 or p_slot >= n then raise exception 'Invalid slot'; end if;
  if cards->>p_slot is not null then cards:=jsonb_set(cards,array[p_slot::text],'null');
  else
   select coalesce(array_agg(value::int),'{}') into occupied from jsonb_array_elements_text(cards) where value is not null;
   select coalesce(array_agg(i),'{}') into pool from unnest(d.remaining) i where not(i=any(occupied));
   if cardinality(pool)=0 then select coalesce(array_agg(i),'{}') into pool from generate_series(0,jsonb_array_length(d.questions)-1) i where not(i=any(occupied)); end if;
   if cardinality(pool)=0 then raise exception 'Not enough questions'; end if;
   select i into chosen from unnest(pool) i order by random() limit 1;
   cards:=jsonb_set(cards,array[p_slot::text],to_jsonb(chosen)); d.remaining:=array_remove(pool,chosen); d.current:=chosen; d.revealed:=true;
  end if;
  t:=jsonb_set(t,'{cards}',cards);
 else raise exception 'Invalid action'; end if;
 update public.question_decks set table_state=t,remaining=d.remaining,current=d.current,revealed=d.revealed,revision=d.revision+1,last_action='table',updated_at=now() where id=p_id returning * into d;
 perform realtime.send(jsonb_build_object('revision',d.revision),'deck_updated','question-deck:'||p_id::text,false);
 return jsonb_build_object('status','ok','deck',question_private.deck_json(d));
end; $$;
revoke all on function public.change_question_table(uuid,bigint,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.change_question_table(uuid,bigint,text,integer,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
