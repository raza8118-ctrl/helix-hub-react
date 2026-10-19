-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 1.6 — "Report wrong info" on the payer card
-- Run once in Supabase → SQL Editor, AFTER 20261019_payer_directory.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the table.
-- Reports are never deleted — they are marked resolved. No patient data.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.payer_reports (
  id                bigint generated always as identity primary key,
  payer_id          bigint      not null,
  section           text,                    -- e.g. 'Contacts'
  entity_table      text,                    -- e.g. 'payer_contacts'
  entity_id         bigint,                  -- the entry reported (null = the payer in general)
  entity_title      text,                    -- what the reporter saw, e.g. 'Claims'
  message           text        not null,
  status            text        not null default 'open' check (status in ('open', 'resolved')),
  reported_by       text,
  reported_by_name  text,
  created_at        timestamptz not null default now(),
  resolved_by       text,
  resolved_at       timestamptz,
  resolution_note   text
);
create index if not exists payer_reports_payer_idx on rcm.payer_reports (payer_id);

grant select, insert, update on rcm.payer_reports to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
