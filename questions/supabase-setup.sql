-- Run in the existing Supabase project's SQL Editor. Does not alter gallery data.
-- Safe to rerun: it creates an initial deck only when no question decks exist.
-- The returned embed_url is a private capability link. Do not commit its ID.
begin;

create table if not exists public.question_decks (
  id uuid primary key default gen_random_uuid(),
  questions jsonb not null,
  question_meta jsonb not null,
  settings jsonb not null default '{}'::jsonb,
  remaining integer[] not null,
  current integer,
  revealed boolean not null default false,
  revision bigint not null default 0,
  last_action text not null default 'edit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.question_decks enable row level security;
alter table public.question_decks add column if not exists settings jsonb not null default '{}'::jsonb;
revoke all on table public.question_decks from public, anon, authenticated;

create schema if not exists question_private;
revoke all on schema question_private from public, anon, authenticated;

create or replace function question_private.request_deck_id()
returns text language sql stable set search_path = '' as $$
  select lower(nullif(coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-question-deck', ''));
$$;

create or replace function question_private.deck_json(d public.question_decks)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('questions', d.questions,
    'items', (select jsonb_agg(jsonb_build_object('text', q.value #>> '{}') || (d.question_meta -> (q.ordinality - 1)::integer) order by q.ordinality) from jsonb_array_elements(d.questions) with ordinality as q),
    'remaining', to_jsonb(d.remaining), 'settings', d.settings,
    'current', d.current, 'revealed', d.revealed, 'revision', d.revision,
    'last_action', d.last_action, 'updated_at', d.updated_at);
$$;
revoke all on function question_private.request_deck_id() from public, anon, authenticated;
revoke all on function question_private.deck_json(public.question_decks) from public, anon, authenticated;

create or replace function public.get_question_deck(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select question_private.deck_json(d) from public.question_decks d
  where d.id = p_id and question_private.request_deck_id() = p_id::text;
$$;

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

revoke all on function public.get_question_deck(uuid) from public, anon, authenticated;
revoke all on function public.change_question_deck(uuid, bigint, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.get_question_deck(uuid) to anon, authenticated;
grant execute on function public.change_question_deck(uuid, bigint, text, jsonb, boolean) to anon, authenticated;

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

insert into public.question_decks (questions, question_meta, remaining)
select '["最近，有什么小事让你觉得这一天还不错？","如果多出一个完全自由的下午，你想怎么度过？","有没有一个你曾经很确定、后来改变了的想法？","你会怎样向一个新朋友介绍你喜欢的地方？","最近读到或看到的什么内容，让你想找人聊一聊？","什么样的时刻，会让你觉得自己被理解了？","有没有一件你一直想学，却还没开始的事？","如果可以重访某一天，你想回去看看什么？","你觉得，一段舒服的对话需要什么？","有没有一个看似普通、却对你很重要的习惯？","对于同一件事，我们可能会有哪些不同的理解？","有什么问题，是你现在还没有答案、但愿意继续想的？"]'::jsonb,
  (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_at', now())) from generate_series(0, 11)),
  array(select generate_series(0, 11))
where not exists (select 1 from public.question_decks);

notify pgrst, 'reload schema';
commit;

select id as deck_id,
  'https://handeesome.github.io/notion-widgets/questions/?mode=box&id=' || id::text as embed_url
from public.question_decks order by created_at asc limit 1;
