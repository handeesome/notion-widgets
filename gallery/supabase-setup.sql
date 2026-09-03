-- Run this file once in Supabase: SQL Editor > New query > Run.
-- The final result table contains the private gallery_id used in both URLs.

begin;

create extension if not exists pgcrypto;

create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.galleries enable row level security;
revoke all on table public.galleries from public, anon, authenticated;

create schema if not exists gallery_private;
revoke all on schema gallery_private from public;
grant usage on schema gallery_private to anon, authenticated;

create or replace function gallery_private.request_gallery_id()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(
    nullif(
      coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-gallery-id',
      ''
    )
  );
$$;

create or replace function gallery_private.gallery_exists(p_gallery_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.galleries
    where id::text = p_gallery_id
  );
$$;

create or replace function gallery_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists galleries_set_updated_at on public.galleries;
create trigger galleries_set_updated_at
before update on public.galleries
for each row execute function gallery_private.set_updated_at();

create or replace function public.get_gallery(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select config
  from public.galleries
  where id = p_id
    and gallery_private.request_gallery_id() is not distinct from p_id::text;
$$;

create or replace function public.update_gallery(p_id uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_config jsonb;
  image_item jsonb;
begin
  if gallery_private.request_gallery_id() is distinct from p_id::text then
    return null;
  end if;

  if jsonb_typeof(p_config) is distinct from 'object'
     or jsonb_typeof(p_config -> 'images') is distinct from 'array' then
    raise exception 'Invalid gallery configuration';
  end if;

  if jsonb_array_length(p_config -> 'images') > 20
     or octet_length(p_config::text) > 262144 then
    raise exception 'Gallery configuration is too large';
  end if;

  for image_item in select value from jsonb_array_elements(p_config -> 'images')
  loop
    if jsonb_typeof(image_item) is distinct from 'object'
       or coalesce(image_item ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(image_item ->> 'path', '') is distinct from
          (p_id::text || '/' || (image_item ->> 'id') || '.webp')
       or length(coalesce(image_item ->> 'name', '')) > 300
       or length(coalesce(image_item ->> 'alt', '')) > 500 then
      raise exception 'Invalid gallery image';
    end if;
  end loop;

  update public.galleries
  set config = p_config
  where id = p_id
  returning config into next_config;

  return next_config;
end;
$$;

revoke all on function public.get_gallery(uuid) from public;
revoke all on function public.update_gallery(uuid, jsonb) from public;
grant execute on function public.get_gallery(uuid) to anon, authenticated;
grant execute on function public.update_gallery(uuid, jsonb) to anon, authenticated;
grant execute on function gallery_private.request_gallery_id() to anon, authenticated;
grant execute on function gallery_private.gallery_exists(text) to anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'gallery-images',
  'gallery-images',
  true,
  8388608,
  array['image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "gallery images select by capability" on storage.objects;
create policy "gallery images select by capability"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'gallery-images'
  and (storage.foldername(name))[1] = gallery_private.request_gallery_id()
  and gallery_private.gallery_exists(gallery_private.request_gallery_id())
);

drop policy if exists "gallery images insert by capability" on storage.objects;
create policy "gallery images insert by capability"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'gallery-images'
  and (storage.foldername(name))[1] = gallery_private.request_gallery_id()
  and gallery_private.gallery_exists(gallery_private.request_gallery_id())
  and name ~ (
    '^' || gallery_private.request_gallery_id()
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
  )
);

drop policy if exists "gallery images delete by capability" on storage.objects;
create policy "gallery images delete by capability"
on storage.objects
for delete
to anon, authenticated
using (
  bucket_id = 'gallery-images'
  and (storage.foldername(name))[1] = gallery_private.request_gallery_id()
  and gallery_private.gallery_exists(gallery_private.request_gallery_id())
);

insert into public.galleries (config)
values (
  '{
    "version": 1,
    "images": [],
    "imageSizing": "cover",
    "autoplayMs": 3000,
    "transitionMs": 500,
    "showDots": true,
    "overlayArrows": false,
    "dropShadow": false,
    "transparentBackground": false,
    "slideBackground": "#f8cc82",
    "widgetBackground": "#f8cc82",
    "arrowColor": "#191919",
    "dotsColor": "#191919"
  }'::jsonb
)
returning id as gallery_id;

commit;

select id as gallery_id
from public.galleries
order by created_at desc
limit 1;
