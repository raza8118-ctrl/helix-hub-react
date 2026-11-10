-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Import (PO request 2026-11-10), Stage 1. Migration 53.
-- Run once in Supabase → SQL Editor. Additive only (one new table per company, two new columns); safe to re-run.
--
--   • import_templates — saved column matchings ("Waystar payer list"): data type, name, the file's header signature,
--     field → column mapping and one-value-for-every-row settings. One per company (home, every company, the master
--     library), so a company's matchings stay with that company. Same access rule as the company's other tables.
--   • import_file / imported_at on the library tables — the source file name and date of the import that last
--     added or filled a row. Existing rows are not touched.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.import_templates (
  id          bigint generated always as identity primary key,
  data_type   text        not null,          -- ref_codes · payers · denial_codes · denial_steps · sops · clients
  name        text        not null,
  signature   text        not null,          -- the file's headers, normalised and joined
  mapping     jsonb       not null default '{}'::jsonb,   -- field → column number
  constants   jsonb       not null default '{}'::jsonb,   -- field → one value for every row
  header_row  int,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create index if not exists import_templates_type on rcm.import_templates (data_type, signature);

-- the same table in every company copy (incl. the master library)
do $$
declare
  v_prefix text;
begin
  for v_prefix in select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'import_templates')) is null then
      perform rcm._clone_table('import_templates', v_prefix || 'import_templates');
    end if;
  end loop;
end;
$$;
grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;

-- source file + date on the library tables (home, every company, the master)
do $$
declare
  v_prefix text;
  t        text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    foreach t in array array['payers', 'payer_plans', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_notes', 'payer_auth_rules',
                             'denial_codes', 'denial_steps', 'ref_codes', 'sop_categories', 'sop_software', 'sop_tasks', 'sops', 'clients'] loop
      if to_regclass(format('rcm.%I', v_prefix || t)) is not null then
        execute format('alter table rcm.%I add column if not exists import_file text', v_prefix || t);
        execute format('alter table rcm.%I add column if not exists imported_at timestamptz', v_prefix || t);
      end if;
    end loop;
  end loop;
end;
$$;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
