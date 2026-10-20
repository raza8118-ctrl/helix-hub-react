-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 5.2 — Appeal letter templates (placeholders only)
-- Run once in Supabase → SQL Editor, AFTER 20261021e_denial_steps.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
--   • body is plain letter text with placeholders such as [PATIENT_NAME],
--     [CLAIM_NUMBER], [AUTH_NUMBER]. Real values are filled in only in the
--     user's browser; filled letters are never stored or logged.
--   • A line starting with "?" is optional: it is left out when any
--     placeholder in it is empty.
--   • denial_type: auth / timely / necessity / eligibility / duplicate / coding / other.
--   • level: null = any appeal level, or first / second / recon / corrected.
--   • client_id: null = all clients, or one client's own wording (rcm.clients.id).
--   • source: 'starter' (built-in wording, to be reviewed) or 'manual'.
--   • No patient data (PHI) belongs in this table. Nothing is deleted (active = false).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.appeal_templates (
  id           bigint generated always as identity primary key,
  name         text        not null,
  denial_type  text        not null,
  level        text,
  client_id    bigint,
  body         text        not null,
  source       text        not null default 'manual',
  reviewed_at  timestamptz,
  reviewed_by  text,                              -- users.emp_id
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.appeal_templates to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
