-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 0.4 — audit log: which record was changed + who may view the log
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run.
-- Afterwards, click "↻ Sync structure" in the Owner Console so every added
-- company gets the same columns.
-- ═══════════════════════════════════════════════════════════════════════════

-- Already exists on the home company; created here only for a fresh database.
create table if not exists rcm.audit_log (
  id             bigint generated always as identity primary key,
  actor_emp_id   text,
  actor_name     text,
  actor_role     text,
  action         text not null,
  target_emp_id  text,
  target_name    text,
  details        jsonb,
  created_at     timestamptz not null default now()
);

-- Which record an entry is about (e.g. entity_type 'allocation', entity_id '42')
alter table rcm.audit_log add column if not exists entity_type text;
alter table rcm.audit_log add column if not exists entity_id   text;
create index if not exists audit_log_created_at_idx on rcm.audit_log (created_at desc);

-- Admins always see the Audit Log page; admins can grant it to anyone else
alter table rcm.users add column if not exists can_view_audit boolean not null default false;

grant select, insert on rcm.audit_log to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
