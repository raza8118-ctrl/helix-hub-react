-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 10.2 — Reports: optional denial code on Smart Worklist claims
-- Run once in Supabase → SQL Editor, AFTER 20261021v_credentialing.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company's worklist_items gets the new column.
--
-- denial_code = the CARC / RARC code(s) from the uploaded aging / denial file
-- (e.g. "CO-197"). Not patient data. Filled only when the file has such a
-- column; used by 📈 Reports → Denial trends (top denial codes).
-- ═══════════════════════════════════════════════════════════════════════════

alter table rcm.worklist_items add column if not exists denial_code text;

notify pgrst, 'reload schema';
