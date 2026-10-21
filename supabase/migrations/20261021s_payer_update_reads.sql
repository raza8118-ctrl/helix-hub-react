-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 8.2 — Payer Updates: who has read each change (“✓ Got it”)
-- Run once in Supabase → SQL Editor, AFTER 20261021r_payer_updates.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
-- No patient data: only which person read which payer change, and when.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.payer_update_reads (
  update_id  bigint      not null,               -- rcm.payer_updates.id
  emp_id     text        not null,               -- users.emp_id
  read_at    timestamptz not null default now(),
  primary key (update_id, emp_id)
);
create index if not exists payer_update_reads_emp_idx on rcm.payer_update_reads (emp_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.payer_update_reads to anon, authenticated;

notify pgrst, 'reload schema';
