-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 9.3 — Credentialing assistant (Workbench → 🪪 Credentialing):
-- providers, payer enrollments and expiring items (licenses, accreditation…)
-- Run once in Supabase → SQL Editor, AFTER 20261021u_payer_auth_rules.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
-- No patient data. Provider name and NPI are public business identifiers.
-- Practitioner SSN, date of birth and home address are deliberately NOT stored
-- (no columns for them).
--   • cred_providers.kind: agency, individual
--   • cred_providers.provider_type: agency, physician, np, therapist, rn, other
--   • cred_enrollments.status: not_started, submitted, in_process, approved,
--     denied, termed
--   • cred_expirables.item_type: state_license, accreditation, liability,
--     medicare_reval, medicaid_reval, clia, dea, board_cert, other
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.cred_providers (
  id                bigint generated always as identity primary key,
  kind              text        not null default 'individual' check (kind in ('agency', 'individual')),
  name              text        not null,
  provider_type     text        not null default 'other',
  npi               text,
  caqh_id           text,
  caqh_attested_on  date,                         -- next attestation due 120 days later
  client_id         bigint,                       -- rcm.clients.id (the agency / client they belong to)
  notes             text,
  active            boolean     not null default true,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_by        text,
  updated_at        timestamptz not null default now()
);

create table if not exists rcm.cred_enrollments (
  id                 bigint generated always as identity primary key,
  provider_id        bigint      not null,        -- rcm.cred_providers.id
  payer_id           bigint      not null,        -- rcm.payers.id
  status             text        not null default 'not_started',
  submitted_on       date,
  last_followup_on   date,
  effective_on       date,
  payer_provider_id  text,                        -- ID the payer assigned
  revalidation_due   date,
  rep_name           text,
  rep_phone          text,
  notes              text,
  active             boolean     not null default true,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_by         text,
  updated_at         timestamptz not null default now()
);
create index if not exists cred_enrollments_provider_idx on rcm.cred_enrollments (provider_id);

create table if not exists rcm.cred_expirables (
  id           bigint generated always as identity primary key,
  provider_id  bigint      not null,              -- rcm.cred_providers.id
  item_type    text        not null default 'other',
  number       text,                              -- license / certificate / policy number
  issuer       text,
  expires_on   date,
  notes        text,
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create index if not exists cred_expirables_provider_idx on rcm.cred_expirables (provider_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.cred_providers, rcm.cred_enrollments, rcm.cred_expirables to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
