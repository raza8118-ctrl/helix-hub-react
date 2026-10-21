-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 8.3 — Suggested Payer Directory changes from payer bulletins
-- (Payer Updates → 🛠 Directory suggestions; approved by “Edit Payer Directory”)
-- Run once in Supabase → SQL Editor, AFTER 20261021s_payer_update_reads.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
-- Nothing is applied to the directory until a person approves it. No PHI —
-- payer contact details, payer IDs, filing limits and notes only.
--   • section: contact (payer_contacts), payer_id (payer_ids),
--              limit (payer_limits, base limits only), note (payer_notes)
--   • action:  add (new row) or update (target_row_id = the row it changes)
--   • proposed / current: the suggested values / a snapshot of the matching
--     row when the suggestion was made
--   • status:  pending, approved, rejected (rows are kept either way)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.payer_directory_suggestions (
  id              bigint generated always as identity primary key,
  bulletin_id     bigint,                         -- rcm.payer_bulletins.id
  payer_id        bigint,                         -- rcm.payers.id (null until matched)
  payer_name      text,                           -- as written in the bulletin
  section         text        not null check (section in ('contact', 'payer_id', 'limit', 'note')),
  action          text        not null default 'add' check (action in ('add', 'update')),
  target_row_id   bigint,
  proposed        jsonb       not null default '{}'::jsonb,
  current         jsonb,
  evidence        text,                           -- quoted sentence from the bulletin
  source_page     int,
  status          text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by      text,
  decided_at      timestamptz,
  reason          text,
  applied_row_id  bigint,
  created_by      text,
  created_at      timestamptz not null default now()
);
create index if not exists payer_directory_suggestions_status_idx on rcm.payer_directory_suggestions (status, payer_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.payer_directory_suggestions to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
