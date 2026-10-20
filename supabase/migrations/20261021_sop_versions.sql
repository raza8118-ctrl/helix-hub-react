-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 3.4 — SOP versions, client-specific SOPs, Acknowledge + read tracking
-- Run once in Supabase → SQL Editor, AFTER 20261020b_sop_media.sql
-- (and after 20261018c_clients_payers.sql, which creates the clients list).
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables and columns.
--
--   • rcm.sops stays the editors' WORKING COPY. Publishing freezes it into
--     rcm.sop_versions (v1, v2…). Readers see the CURRENT version = the newest
--     one whose effective_date has arrived; older ones are "archived", future
--     ones "upcoming" — worked out from the dates, so no scheduled job is needed.
--   • snapshot = { title, summary, purpose, audience_teams, audience_notes,
--     prerequisites, steps, expected_result, troubleshooting, walkthrough_video }.
--     Screenshot/video files are never deleted (rcm.sop_media), so old versions
--     keep showing theirs.
--   • sops.client_id → rcm.clients.id (null = common SOP for all clients);
--     sops.copied_from → rcm.sops.id of the common SOP a client copy came from.
--   • sop_reads: one row per person per version — opens and acknowledgement.
--   • Ids rather than foreign keys (company copies don't carry foreign keys).
--   • No patient data (PHI) belongs in any of these tables. Nothing is deleted.
-- ═══════════════════════════════════════════════════════════════════════════

alter table rcm.sops add column if not exists client_id   bigint;
alter table rcm.sops add column if not exists copied_from bigint;
create index if not exists sops_client_idx on rcm.sops (client_id);

create table if not exists rcm.sop_versions (
  id              bigint generated always as identity primary key,
  sop_id          bigint      not null,          -- rcm.sops.id
  version_no      int         not null,
  snapshot        jsonb       not null,
  change_note     text        not null,
  effective_date  date        not null default current_date,
  requires_ack    boolean     not null default true,
  published_by    text,                          -- users.emp_id
  published_at    timestamptz not null default now()
);
create index if not exists sop_versions_sop_idx on rcm.sop_versions (sop_id);
create unique index if not exists sop_versions_no_key on rcm.sop_versions (sop_id, version_no);

create table if not exists rcm.sop_reads (
  id               bigint generated always as identity primary key,
  sop_id           bigint      not null,         -- rcm.sops.id
  version_id       bigint      not null,         -- rcm.sop_versions.id
  emp_id           text        not null,         -- users.emp_id
  first_viewed_at  timestamptz not null default now(),
  last_viewed_at   timestamptz not null default now(),
  view_count       int         not null default 1,
  acknowledged_at  timestamptz
);
create unique index if not exists sop_reads_person_key on rcm.sop_reads (version_id, emp_id);
create index if not exists sop_reads_emp_idx on rcm.sop_reads (emp_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.sop_versions, rcm.sop_reads to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
