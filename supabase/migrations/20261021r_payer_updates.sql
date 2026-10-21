-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 8.1 — Payer Updates Feed: payer bulletins + the changes extracted
-- from them (Workbench → 📰 Payer Updates)
-- Run once in Supabase → SQL Editor, AFTER 20261021q_medicare_trackers.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
-- Payer bulletins / newsletters / policy updates hold NO patient data (PHI).
-- The app asks the uploader to confirm that every time and scans the PDF text
-- for patient words before anything is sent to the AI.
-- PDFs live in a PRIVATE bucket and are opened with short-lived signed links.
-- The app has no Supabase Auth yet, so anyone holding the app's public key can
-- still read the bucket; acceptable only because bulletins hold no PHI.
--   • payer_updates.category: billing, authorization, coding, fee_schedule,
--     policy, forms_portals, credentialing, other
--   • payer_updates.teams: subset of AR, Auth, Billing/Posting, Coding,
--     Credentialing
--   • payer_updates.status: active, retired
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.payer_bulletins (
  id               bigint generated always as identity primary key,
  title            text        not null,
  issuer           text,                          -- who published it (payer / MAC / CMS)
  published_on     date,
  file_path        text,                          -- storage path in bucket payer-bulletins
  file_name        text,
  pages            int,
  extracted_by_ai  boolean     not null default false,
  uploaded_by      text,
  uploaded_at      timestamptz not null default now(),
  active           boolean     not null default true,
  updated_by       text,
  updated_at       timestamptz not null default now()
);

create table if not exists rcm.payer_updates (
  id              bigint generated always as identity primary key,
  bulletin_id     bigint      not null,           -- rcm.payer_bulletins.id
  payer_id        bigint,                         -- rcm.payers.id when matched
  payer_name      text,                           -- as written in the bulletin
  effective_date  date,
  change_text     text        not null,
  category        text        not null default 'other',
  teams           text[]      not null default '{}',
  action_needed   text,
  source_page     int,
  status          text        not null default 'active' check (status in ('active', 'retired')),
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz not null default now()
);
create index if not exists payer_updates_bulletin_idx on rcm.payer_updates (bulletin_id);
create index if not exists payer_updates_payer_idx on rcm.payer_updates (payer_id, effective_date);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.payer_bulletins, rcm.payer_updates to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

-- Private bucket: PDF only, max 30 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payer-bulletins', 'payer-bulletins', false, 31457280, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read (for signed links) and add only — no update or delete
drop policy if exists payer_bulletins_read on storage.objects;
create policy payer_bulletins_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'payer-bulletins');

drop policy if exists payer_bulletins_insert on storage.objects;
create policy payer_bulletins_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'payer-bulletins');

notify pgrst, 'reload schema';
