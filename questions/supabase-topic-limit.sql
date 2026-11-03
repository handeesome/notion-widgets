-- Apply after supabase-topics.sql. No data is rewritten.
begin;
create or replace function question_private.reset_table_questions() returns trigger language plpgsql set search_path='' as $$
begin
 if (select count(distinct nullif(nullif(m->>'topic',''),'未分类')) from jsonb_array_elements(new.question_meta) m) > greatest(6,(select count(distinct nullif(nullif(m->>'topic',''),'未分类')) from jsonb_array_elements(old.question_meta) m)) then raise exception 'Too many topics'; end if;
 if new.questions is distinct from old.questions or new.question_meta is distinct from old.question_meta then
 new.table_state := jsonb_build_object('play',coalesce(old.table_state->>'play','single'),'topic','','card',null,'history','[]'::jsonb,'last',null);
 end if;
 return new;
end; $$;
commit;
