-- ═══════════════════════════════════════════════════════════════════════════
-- Restore payer_reports (fix, PO request 2026-11-01)
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run. No "Sync structure" needed.
--
--   • Migration 6 (20261019c_payer_reports.sql — "Report wrong info" on the payer card, roadmap 1.6) was skipped on
--     2026-10-29, so the table never existed. This creates it exactly as that file defined it — don't re-run the old file.
--   • Every added company gets its copy here (rcm._clone_table), and every copy gets the stage-3 company rules.
--   • Reports are never deleted — they are marked resolved. No patient data.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.payer_reports (
  id                bigint generated always as identity primary key,
  payer_id          bigint      not null,
  section           text,                    -- e.g. 'Contacts'
  entity_table      text,                    -- e.g. 'payer_contacts'
  entity_id         bigint,                  -- the entry reported (null = the payer in general)
  entity_title      text,                    -- what the reporter saw, e.g. 'Claims'
  message           text        not null,
  status            text        not null default 'open' check (status in ('open', 'resolved')),
  reported_by       text,
  reported_by_name  text,
  created_at        timestamptz not null default now(),
  resolved_by       text,
  resolved_at       timestamptz,
  resolution_note   text
);
create index if not exists payer_reports_payer_idx on rcm.payer_reports (payer_id);

grant select, insert, update on rcm.payer_reports to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

-- A copy for every added company (what "Sync structure" would do)
do $$
declare
  v_prefix text;
begin
  for v_prefix in select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'payer_reports')) is null then
      perform rcm._clone_table('payer_reports', v_prefix || 'payer_reports');
    end if;
  end loop;
end $$;
grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
