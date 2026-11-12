-- ═══════════════════════════════════════════════════════════════════════════
-- Home-company table grants (fix, 2026-11-11). Migration 57.
-- Run once in Supabase → SQL Editor. Additive only (grants); safe to re-run.
--
--   Migrations 53, 55 and 56 created new tables and copied them into every company (the copies get their grants from
--   _clone_table), but the HOME company's own tables were never granted to the app's roles — so home users got
--   "permission denied" (e.g. saving a Smart Import matching, adding a PDF to a home SOP, saving a Coding Assistant list).
--   Same pattern as the older tables: read / add / edit, no delete. The usual row rules (protect_all_tables) still apply.
-- ═══════════════════════════════════════════════════════════════════════════

grant select, insert, update on rcm.import_templates, rcm.icd_notes, rcm.icd_index, rcm.icd_changes, rcm.sop_documents, rcm.coding_results
  to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;

notify pgrst, 'reload schema';
