-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 9.2 — Authorization rules per payer + service (payer card section
-- “🔐 Authorization rules”, used by Ask Helix → 🔐 Auth checklist)
-- Run once in Supabase → SQL Editor, AFTER 20261021t_payer_suggestions.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
-- No patient data: payer rules only.
--   • service: hh_soc, hh_recert, skilled_nursing, therapy, hospice, dme, other
--   • auth_required: yes, no, after_visits (visits_threshold), notify
--   • submit_method: portal, fax, phone, edi_278
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.payer_auth_rules (
  id                bigint generated always as identity primary key,
  payer_id          bigint      not null,         -- rcm.payers.id
  plan_id           bigint,                       -- rcm.payer_plans.id; null = all plans
  service           text        not null,
  auth_required     text        not null default 'yes',
  visits_threshold  int,                          -- auth needed after this many visits
  submit_method     text,
  turnaround_days   int,                          -- decision usually takes (working days)
  valid_days        int,                          -- auth valid for
  documents         text,                         -- what to send
  retro_allowed     boolean     not null default false,
  retro_days        int,
  notes             text,
  active            boolean     not null default true,
  verified_at       timestamptz,
  verified_by       text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_by        text,
  updated_at        timestamptz not null default now()
);
create index if not exists payer_auth_rules_payer_idx on rcm.payer_auth_rules (payer_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.payer_auth_rules to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
