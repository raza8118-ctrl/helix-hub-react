-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 3.2 — SOP page template
-- Run once in Supabase → SQL Editor, AFTER 20261019d_sop_library.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the same columns.
--
-- Adds the template sections to rcm.sops:
--   Purpose · Who uses it · Before you start · Steps · What you should see ·
--   If it goes wrong · Last verified (date + by). Owner already exists (3.1).
--   • steps is a JSON list: [{ "text": "...", "tip": "...", "image": null }]
--     ("image" is filled by the screenshot uploads in step 3.3).
--   • No patient data (PHI) belongs in any of these columns.
-- ═══════════════════════════════════════════════════════════════════════════

alter table rcm.sops add column if not exists purpose          text;
alter table rcm.sops add column if not exists audience_teams   text[] not null default '{}';
alter table rcm.sops add column if not exists audience_notes   text;
alter table rcm.sops add column if not exists prerequisites    text;
alter table rcm.sops add column if not exists steps            jsonb  not null default '[]'::jsonb;
alter table rcm.sops add column if not exists expected_result  text;
alter table rcm.sops add column if not exists troubleshooting  text;
alter table rcm.sops add column if not exists last_verified_at timestamptz;
alter table rcm.sops add column if not exists last_verified_by text;   -- users.emp_id

notify pgrst, 'reload schema';
