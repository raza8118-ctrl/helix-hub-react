-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 6.6 — Portal launchpad per client (AR Tools → 🚀 Portal launchpad)
-- Run once in Supabase → SQL Editor, AFTER 20261021k_followups.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
-- One row = one tile on a client's launchpad:
--   • kind 'software' → software_id = rcm.sop_software.id (SOP Library); url
--     empty = use the software's standard login link.
--   • kind 'payer'    → payer_id = rcm.payers.id; url empty = use the Payer
--     Directory portal link.
--   • kind 'custom'   → label + url typed by a manager.
--   • client_id empty = shown for every client.
-- NEVER credentials: there is no username / password column, and the app
-- refuses access notes that mention passwords. No patient data (PHI).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.client_portals (
  id           bigint generated always as identity primary key,
  client_id    bigint,                            -- rcm.clients.id; null = all clients
  kind         text        not null default 'custom' check (kind in ('software', 'payer', 'custom')),
  software_id  bigint,                            -- rcm.sop_software.id (kind software)
  payer_id     bigint,                            -- rcm.payers.id (kind payer)
  label        text,                              -- name shown; empty = software / payer name
  url          text,                              -- login page; empty = standard link
  access_note  text,                              -- how to get access, MFA… never passwords
  sort_order   int         not null default 0,
  verified_at  timestamptz,                       -- "✓ Link checked"
  verified_by  text,
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create index if not exists client_portals_client_idx on rcm.client_portals (client_id);

-- Read / add / edit only — no delete grant (links are turned off, never deleted)
grant select, insert, update on rcm.client_portals to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
