-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 4.2 — Denial Navigator layered steps: Client → Payer → Common 3Gen
-- Run once in Supabase → SQL Editor, AFTER 20261021d_denial_codes.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
--   • One row = what to do for one denial code (code_id → rcm.denial_codes.id)
--     in one layer: scope 'common' (3Gen standard), 'client' (client_id →
--     rcm.clients.id) or 'payer' (payer_id → rcm.payers.id).
--   • steps uses the SOP text marks (numbered lines, **bold**, - bullets, ! important).
--   • sop_id optionally links an SOP (rcm.sops.id), e.g. the client's SOP.
--   • Only one ACTIVE row per code + layer + client/payer (the app checks this;
--     company copies don't carry partial unique indexes reliably).
--   • No patient data (PHI) belongs here. Nothing is deleted (active = false).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.denial_steps (
  id           bigint generated always as identity primary key,
  code_id      bigint      not null,
  scope        text        not null check (scope in ('common', 'client', 'payer')),
  client_id    bigint,
  payer_id     bigint,
  steps        text        not null,
  sop_id       bigint,
  notes        text,
  verified_at  timestamptz,
  verified_by  text,                              -- users.emp_id
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create index if not exists denial_steps_code_idx on rcm.denial_steps (code_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.denial_steps to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
