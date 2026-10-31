-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Worklist — automatic 90-day clearing (PO request 2026-10-31, fix to roadmap 6.4)
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run. No "Sync structure" needed (no tables change).
-- If Supabase says pg_cron isn't available: Database → Extensions → enable "pg_cron", then run this file again.
--
--   • Claim # and dates of service on a worklist must be wiped 90 days after upload. Until now the app did that only
--     when a manager opened Smart Worklist. This adds a nightly job that does it on its own.
--   • rcm.clear_old_worklists() does exactly what the app's "🔒 Close & clear details" does, for the home company and
--     every added company (co_<code>__ tables): blanks claim_number / dos_from / dos_to, marks the items cleared,
--     closes the worklist and writes an Audit Log entry ("Helix Hub (automatic)"). Statuses, $ and rows are kept.
--     Nothing is deleted. The app's own check stays as a backup.
--   • Only the scheduler runs it — app users (anon / authenticated) can't call it.
--   • Schedule: every day at 02:30 UTC (8:00 AM IST).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

create or replace function rcm.clear_old_worklists()
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix  text;
  v_ids     bigint[];
  v_total   int := 0;
  v_out     jsonb := '{}'::jsonb;
  v_entity  boolean;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    -- Skip a company whose worklist tables don't exist yet (structure not synced)
    if to_regclass(format('rcm.%I', v_prefix || 'worklists')) is null
       or to_regclass(format('rcm.%I', v_prefix || 'worklist_items')) is null then
      continue;
    end if;

    execute format(
      'select coalesce(array_agg(id), ''{}'') from rcm.%I
        where cleared_at is null and uploaded_at < now() - interval ''90 days''',
      v_prefix || 'worklists') into v_ids;
    if coalesce(array_length(v_ids, 1), 0) = 0 then continue; end if;

    execute format(
      'update rcm.%I set claim_number = null, dos_from = null, dos_to = null, cleared = true,
              updated_by = ''SYSTEM'', updated_at = now()
        where worklist_id = any($1)',
      v_prefix || 'worklist_items') using v_ids;

    execute format(
      'update rcm.%I set status = ''closed'', closed_at = coalesce(closed_at, now()), cleared_at = now(),
              updated_by = ''SYSTEM'', updated_at = now()
        where id = any($1)',
      v_prefix || 'worklists') using v_ids;

    -- Audit Log: one entry per worklist (same action as the app's automatic clear)
    if to_regclass(format('rcm.%I', v_prefix || 'audit_log')) is not null then
      select exists (select 1 from information_schema.columns
                      where table_schema = 'rcm' and table_name = v_prefix || 'audit_log' and column_name = 'entity_type')
        into v_entity;
      if v_entity then
        execute format(
          'insert into rcm.%I (actor_emp_id, actor_name, actor_role, action, entity_type, entity_id, details)
           select ''SYSTEM'', ''Helix Hub (automatic)'', ''system'', ''worklist_close_clear'', ''worklist'', id::text,
                  jsonb_build_object(''automatic'', true, ''by'', ''schedule'')
             from unnest($1) as id',
          v_prefix || 'audit_log') using v_ids;
      else
        execute format(
          'insert into rcm.%I (actor_emp_id, actor_name, actor_role, action, details)
           select ''SYSTEM'', ''Helix Hub (automatic)'', ''system'', ''worklist_close_clear'',
                  jsonb_build_object(''automatic'', true, ''by'', ''schedule'', ''worklist_id'', id)
             from unnest($1) as id',
          v_prefix || 'audit_log') using v_ids;
      end if;
    end if;

    v_total := v_total + array_length(v_ids, 1);
    v_out := v_out || jsonb_build_object(coalesce(nullif(v_prefix, ''), 'home'), array_length(v_ids, 1));
  end loop;

  return jsonb_build_object('cleared', v_total, 'by_company', v_out);
end;
$$;
revoke all on function rcm.clear_old_worklists() from public, anon, authenticated;

-- Nightly job (re-running this file replaces it rather than adding a second one)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'helix-worklist-auto-clear';
  perform cron.schedule('helix-worklist-auto-clear', '30 2 * * *', 'select rcm.clear_old_worklists()');
end $$;
