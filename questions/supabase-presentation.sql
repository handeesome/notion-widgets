-- Upgrade an existing question deck installation; preserves questions and progress.
begin;
alter table public.question_decks add column if not exists settings jsonb not null default '{}'::jsonb;

create or replace function question_private.deck_json(d public.question_decks)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('questions', d.questions,
    'items', (select jsonb_agg(jsonb_build_object('text', q.value #>> '{}') || (d.question_meta -> (q.ordinality - 1)::integer) order by q.ordinality) from jsonb_array_elements(d.questions) with ordinality as q),
    'remaining', to_jsonb(d.remaining), 'settings', d.settings,
    'current', d.current, 'revealed', d.revealed, 'revision', d.revision,
    'last_action', d.last_action, 'updated_at', d.updated_at);
$$;
revoke all on function question_private.deck_json(public.question_decks) from public, anon, authenticated;

create or replace function public.update_question_settings(p_id uuid, p_revision bigint, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.question_decks;
  entry record;
begin
  if question_private.request_deck_id() is distinct from p_id::text then return null; end if;
  select * into d from public.question_decks where id = p_id for update;
  if not found then return null; end if;
  if p_revision is null or p_revision <> d.revision then
    return jsonb_build_object('status', 'conflict', 'deck', question_private.deck_json(d));
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text) > 8192 then raise exception 'Invalid settings'; end if;
  for entry in select key, value from jsonb_each(p_settings) loop
    if entry.key not in ('name', 'frontTop', 'invitation', 'frontBottom', 'backTop', 'backBottom', 'mode', 'theme')
      or jsonb_typeof(entry.value) is distinct from 'string' or char_length(entry.value #>> '{}') > 100 then raise exception 'Invalid setting'; end if;
    if entry.key = 'mode' and (entry.value #>> '{}') not in ('box', 'card') then raise exception 'Invalid mode'; end if;
    if entry.key = 'theme' and (entry.value #>> '{}') not in ('auto', 'light', 'dark') then raise exception 'Invalid theme'; end if;
  end loop;
  if d.settings @> p_settings then return jsonb_build_object('status', 'ok', 'deck', question_private.deck_json(d)); end if;
  update public.question_decks set settings = d.settings || p_settings,
    revision = d.revision + 1, last_action = 'settings', updated_at = now()
    where id = p_id returning * into d;
  perform realtime.send(jsonb_build_object('revision', d.revision), 'deck_updated', 'question-deck:' || p_id::text, false);
  return jsonb_build_object('status', 'ok', 'deck', question_private.deck_json(d));
end;
$$;
revoke all on function public.update_question_settings(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.update_question_settings(uuid, bigint, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
