-- Existing projects: run once in Supabase SQL Editor before deploying the new files.
-- Safe to repeat. Keeps all existing galleries, IDs, images and the 8 MB limit.
begin;

update storage.buckets
set allowed_mime_types = array['image/webp', 'image/png']::text[]
where id = 'gallery-images';

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
       or coalesce(image_item ->> 'path', '') not in (
          p_id::text || '/' || (image_item ->> 'id') || '.webp',
          p_id::text || '/' || (image_item ->> 'id') || '.png'
       )
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
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webp|png)$'
  )
);

commit;
