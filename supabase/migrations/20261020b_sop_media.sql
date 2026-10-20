-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 3.3 — SOP screenshots and short videos
-- Run once in Supabase → SQL Editor, AFTER 20261020_sop_template.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table and column.
--
-- Files live in a PRIVATE bucket and are shown with short-lived signed links,
-- never public URLs. The app has no Supabase Auth yet, so anyone holding the
-- app's public key can still read the bucket; that is acceptable only because
-- SOP media must never show patient information (the app makes uploaders
-- confirm this, and offers a black-out tool for screenshots).
--
--   • sop_media keeps a record of every upload. Removing a screenshot/video
--     from an SOP only unlinks it — the row and the file are kept (step 3.4
--     version history uses them). Nothing is deleted.
--   • Step media is referenced from rcm.sops.steps:
--       [{ "text", "tip", "images": [{ "path", "width", "height" }], "video": { "path", "duration" } }]
--   • walkthrough_video = optional whole-SOP video: { "path", "duration" }.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.sop_media (
  id           bigint generated always as identity primary key,
  sop_id       bigint      not null,                  -- rcm.sops.id
  kind         text        not null check (kind in ('image', 'video')),
  path         text        not null,                  -- path inside the sop-media bucket
  size         bigint,                                -- bytes
  width        int,
  height       int,
  duration     numeric,                               -- seconds (videos)
  active       boolean     not null default true,
  uploaded_by  text,                                  -- users.emp_id
  uploaded_at  timestamptz not null default now()
);
create index if not exists sop_media_sop_idx on rcm.sop_media (sop_id);

alter table rcm.sops add column if not exists walkthrough_video jsonb;

-- Private bucket: screenshots (PNG/JPG/WEBP) and short videos (MP4/WEBM), max 25 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sop-media', 'sop-media', false, 26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read (for signed links) and add only — no update or delete, so nothing is lost
drop policy if exists sop_media_read on storage.objects;
create policy sop_media_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'sop-media');

drop policy if exists sop_media_insert on storage.objects;
create policy sop_media_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'sop-media');

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.sop_media to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
