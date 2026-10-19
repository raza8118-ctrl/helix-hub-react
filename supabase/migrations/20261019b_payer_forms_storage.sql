-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 1.4 — payer form files
-- Run once in Supabase → SQL Editor, AFTER 20261019_payer_directory.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company's payer_forms table gets the new columns.
--
-- Files live in a PRIVATE bucket and are opened with short-lived signed links,
-- never public URLs. Blank payer forms only — never patient documents.
-- The app has no Supabase Auth yet, so anyone holding the app's public key can
-- still read the bucket; that is acceptable only because these forms hold no PHI.
-- ═══════════════════════════════════════════════════════════════════════════

-- Versions: every upload is a row. family_id = id of the first version
-- (null on the first version itself); superseded_at is set when a newer version arrives.
alter table rcm.payer_forms add column if not exists family_id     bigint;
alter table rcm.payer_forms add column if not exists superseded_at timestamptz;
create index if not exists payer_forms_family_idx on rcm.payer_forms (family_id);

-- Private bucket: PDF / Word / Excel, max 10 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payer-forms', 'payer-forms', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read (for signed download links) and add only — no update or delete, so old versions are kept
drop policy if exists payer_forms_read on storage.objects;
create policy payer_forms_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'payer-forms');

drop policy if exists payer_forms_insert on storage.objects;
create policy payer_forms_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'payer-forms');

notify pgrst, 'reload schema';
