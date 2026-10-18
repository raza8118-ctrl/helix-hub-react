-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 0.3 — functional team + QA flag on users
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run.
-- Afterwards, click "↻ Sync structure" in the Owner Console so every added
-- company's users table gets the same columns.
--
--   role  (existing) = permission level: employee / supervisor / manager / admin
--   team  (new)      = functional team: AR, Auth, Billing/Posting, Coding, Credentialing
--   is_qa (new)      = QA reviewer (can belong to a team as well)
-- ═══════════════════════════════════════════════════════════════════════════

alter table rcm.users add column if not exists team  text;
alter table rcm.users add column if not exists is_qa boolean not null default false;

notify pgrst, 'reload schema';
