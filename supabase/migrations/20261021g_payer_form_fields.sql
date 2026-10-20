-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 5.4 — field maps for fillable payer forms (Appeal Builder PDF)
-- Run once in Supabase → SQL Editor, AFTER 20261021f_appeal_templates.sql
-- (and after 20261019_payer_directory.sql, which creates payer_forms).
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company's payer_forms gets the new column.
--
--   • field_map = { "<PDF field name>": rule } where rule is one of
--       { "kind": "token", "token": "[PATIENT_NAME]" }   fill with an appeal value
--       { "kind": "text",  "text": "1234567890" }        fixed text (e.g. provider NPI)
--       { "kind": "check", "when": "always" | "level:recon" | "type:auth" | … }
--   • It describes WHERE values go — it never holds patient data. Forms are
--     filled in the user's browser only; filled forms are never stored.
-- ═══════════════════════════════════════════════════════════════════════════

alter table rcm.payer_forms add column if not exists field_map jsonb;

notify pgrst, 'reload schema';
