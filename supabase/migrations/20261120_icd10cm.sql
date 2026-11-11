-- ═══════════════════════════════════════════════════════════════════════════
-- ICD-10-CM yearly data (PO request 2026-11-11), Stage 1. Migration 55.
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run.
--
--   • ref_codes (home, every company, master): billable, long_description, chapter, section, fiscal_year, change_flag,
--     valid_from, retired_on — so a code can be checked against a date of service.
--   • New tables (home, every company, master — companies read the master's): icd_notes (coding notes), icd_index
--     (index terms), icd_changes ("what changed" per fiscal year), sop_documents (PDFs on an SOP, Stage 4). Each row of
--     icd_notes / icd_index has a key (k) so the same file can be imported again without doubles.
--   • Search indexes (pg_trgm) on the master's descriptions and index terms.
--   • Owner-only import into the MASTER: owner_icd_import_batch (up to 1,000 rows a call), owner_icd_retire_missing
--     (codes not in the new year → retired with a retired date; never deleted), owner_icd_import_done (one owner-log line
--     per file). During these calls the master's per-row change history is skipped (helix.bulk_import), so 200,000
--     reference rows don't flood it.
--   • sop-media storage also accepts PDF (for the Official Guidelines, Stage 4).
-- Reference data only — no patient data.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 ── new columns on the code list ──────────────────────────────────────────
do $$
declare
  v_prefix text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'ref_codes')) is null then continue; end if;
    execute format('alter table rcm.%I add column if not exists billable boolean', v_prefix || 'ref_codes');
    execute format('alter table rcm.%I add column if not exists long_description text', v_prefix || 'ref_codes');
    execute format('alter table rcm.%I add column if not exists chapter text', v_prefix || 'ref_codes');
    execute format('alter table rcm.%I add column if not exists section text', v_prefix || 'ref_codes');
    execute format('alter table rcm.%I add column if not exists fiscal_year int', v_prefix || 'ref_codes');
    execute format('alter table rcm.%I add column if not exists change_flag text', v_prefix || 'ref_codes');
    execute format('alter table rcm.%I add column if not exists valid_from date', v_prefix || 'ref_codes');
    execute format('alter table rcm.%I add column if not exists retired_on date', v_prefix || 'ref_codes');
  end loop;
end;
$$;

-- 2 ── new tables ────────────────────────────────────────────────────────────
create table if not exists rcm.icd_notes (
  id           bigint generated always as identity primary key,
  k            text        not null,               -- md5(code | note type | note): the same note is never added twice
  fiscal_year  int,
  code         text        not null,               -- without the dot, like ref_codes (S72 / S72001A)
  note_type    text        not null,               -- Inclusion term, Excludes1, Excludes2, Use additional code, Code first, 7th characters…
  note         text        not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists icd_notes_k on rcm.icd_notes (k);
create index if not exists icd_notes_code on rcm.icd_notes (code);

create table if not exists rcm.icd_index (
  id           bigint generated always as identity primary key,
  k            text        not null,               -- md5(term | code | see | see also)
  fiscal_year  int,
  term_path    text        not null,               -- "Failure > heart > congestive"
  code         text,                               -- without the dot
  see          text,
  see_also     text,
  created_at   timestamptz not null default now()
);
create unique index if not exists icd_index_k on rcm.icd_index (k);
create index if not exists icd_index_code on rcm.icd_index (code);

create table if not exists rcm.icd_changes (
  id           bigint generated always as identity primary key,
  fiscal_year  int         not null,
  change       text        not null,               -- New, Deleted, Description revised, Now a header (needs more digits)
  code         text        not null,               -- without the dot
  description  text,
  created_at   timestamptz not null default now()
);
create unique index if not exists icd_changes_key on rcm.icd_changes (fiscal_year, change, code);

create table if not exists rcm.sop_documents (
  id           bigint generated always as identity primary key,
  sop_id       bigint      not null,
  title        text        not null,
  path         text        not null,               -- sop-media bucket (company folder / co_master/)
  file_name    text,
  size         bigint,
  active       boolean     not null default true,
  uploaded_by  text,
  uploaded_at  timestamptz not null default now(),
  master_id    bigint,
  master_pushed_at timestamptz,
  master_hash  text
);
create index if not exists sop_documents_sop on rcm.sop_documents (sop_id);

-- the same tables in every company copy (incl. the master)
do $$
declare
  v_prefix text;
  t        text;
begin
  for v_prefix in select prefix from rcm.companies loop
    foreach t in array array['icd_notes', 'icd_index', 'icd_changes', 'sop_documents'] loop
      if to_regclass(format('rcm.%I', v_prefix || t)) is null then
        perform rcm._clone_table(t, v_prefix || t);
      end if;
    end loop;
  end loop;
end;
$$;
grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;

-- 3 ── search indexes on the master (the full ICD-10-CM list lives there) ───────────
create extension if not exists pg_trgm with schema extensions;
do $$
declare
  m text := (select prefix from rcm.companies where is_master);
begin
  if m is null then return; end if;
  execute format('create index if not exists %I on rcm.%I using gin (description extensions.gin_trgm_ops)', m || 'ref_codes_desc_trgm', m || 'ref_codes');
  execute format('create index if not exists %I on rcm.%I using gin (long_description extensions.gin_trgm_ops)', m || 'ref_codes_long_trgm', m || 'ref_codes');
  execute format('create index if not exists %I on rcm.%I using gin (term_path extensions.gin_trgm_ops)', m || 'icd_index_term_trgm', m || 'icd_index');
  execute format('create index if not exists %I on rcm.%I (code_set, code text_pattern_ops)', m || 'ref_codes_code_prefix', m || 'ref_codes');
  execute format('create index if not exists %I on rcm.%I (fiscal_year, change)', m || 'icd_changes_fy', m || 'icd_changes');
end;
$$;

-- 4 ── master change history: skipped during the owner's bulk ICD import ──────────────
create or replace function rcm._master_change_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if coalesce(current_setting('helix.bulk_import', true), '') = 'on' then return null; end if;   -- ICD yearly import (migration 55)
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;   -- nothing really changed
  insert into rcm.helix_master_changes (owner, tbl, row_id, action, before, after)
  values (rcm._master_actor(), substr(tg_table_name, length('co_master__') + 1), coalesce(v_new, v_old)->>'id',
          case tg_op when 'INSERT' then 'add' when 'UPDATE' then 'change' else 'remove' end, v_old, v_new);
  return null;
end;
$$;
revoke all on function rcm._master_change_trg() from public, anon, authenticated;

-- 5 ── owner import (into the master) ─────────────────────────────────────────
create or replace function rcm.owner_icd_import_batch(p_by_user text, p_by_password text, p_kind text, p_fy int, p_file text, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = rcm, extensions, pg_temp
as $$
declare
  m       text := (select prefix from rcm.companies where is_master);
  v_owner text := upper(trim(p_by_user));
  v_from  date := make_date(p_fy - 1, 10, 1);      -- FY2027 starts on Oct 1, 2026
  n       int := 0;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if m is null then return jsonb_build_object('ok', false, 'error', 'no_master'); end if;
  if p_fy is null or p_fy < 2015 or p_fy > 2100 then return jsonb_build_object('ok', false, 'error', 'bad_year'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then return jsonb_build_object('ok', false, 'error', 'bad_rows'); end if;
  perform set_config('helix.bulk_import', 'on', true);

  if p_kind = 'codes' then
    execute format($f$
      insert into rcm.%1$I as t (code_set, code, description, long_description, billable, chapter, section, fiscal_year, list_year, change_flag,
                                valid_from, retired, retired_on, source, active, created_by, updated_by, import_file, imported_at)
      select 'icd10', x.code, x.short, coalesce(x.long, x.short), x.billable, x.chapter, x.section, $2, $2, x.change,
             case when x.change = 'new' then $3 end, false, null, 'cms', true, $4, $4, $5, now()
      from jsonb_to_recordset($1) as x(code text, short text, long text, billable boolean, chapter text, section text, change text)
      where coalesce(x.code, '') <> ''
      on conflict (code_set, code) do update set
        description = excluded.description, long_description = excluded.long_description, billable = excluded.billable,
        chapter = excluded.chapter, section = excluded.section, fiscal_year = excluded.fiscal_year, list_year = excluded.list_year,
        change_flag = excluded.change_flag, valid_from = coalesce(t.valid_from, excluded.valid_from), retired = false, retired_on = null,
        active = true, updated_by = excluded.updated_by, updated_at = now(), import_file = excluded.import_file, imported_at = now()
      $f$, m || 'ref_codes') using p_rows, p_fy, v_from, v_owner, p_file;
    get diagnostics n = row_count;

  elsif p_kind = 'notes' then
    execute format($f$
      insert into rcm.%1$I (k, fiscal_year, code, note_type, note)
      select md5(x.code || '|' || x.type || '|' || x.note), $2, x.code, x.type, x.note
      from jsonb_to_recordset($1) as x(code text, type text, note text)
      where coalesce(x.code, '') <> '' and coalesce(x.note, '') <> ''
      on conflict (k) do nothing
      $f$, m || 'icd_notes') using p_rows, p_fy;
    get diagnostics n = row_count;

  elsif p_kind = 'index' then
    execute format($f$
      insert into rcm.%1$I (k, fiscal_year, term_path, code, see, see_also)
      select md5(x.term || '|' || coalesce(x.code, '') || '|' || coalesce(x.see, '') || '|' || coalesce(x.see_also, '')), $2,
             x.term, nullif(x.code, ''), nullif(x.see, ''), nullif(x.see_also, '')
      from jsonb_to_recordset($1) as x(term text, code text, see text, see_also text)
      where coalesce(x.term, '') <> ''
      on conflict (k) do nothing
      $f$, m || 'icd_index') using p_rows, p_fy;
    get diagnostics n = row_count;

  elsif p_kind = 'changes' then
    execute format($f$
      insert into rcm.%1$I as t (fiscal_year, change, code, description)
      select $2, x.change, x.code, x.description
      from jsonb_to_recordset($1) as x(change text, code text, description text)
      where coalesce(x.code, '') <> ''
      on conflict (fiscal_year, change, code) do update set description = excluded.description
      $f$, m || 'icd_changes') using p_rows, p_fy;
    get diagnostics n = row_count;
    -- deleted codes stay in the list as retired from the start of the year (valid for older dates of service)
    execute format($f$
      insert into rcm.%1$I as t (code_set, code, description, long_description, billable, fiscal_year, list_year, change_flag, retired, retired_on,
                                source, active, created_by, updated_by, import_file, imported_at)
      select 'icd10', x.code, x.description, x.description, true, $2 - 1, $2 - 1, 'deleted', true, $3, 'cms', true, $4, $4, $5, now()
      from jsonb_to_recordset($1) as x(change text, code text, description text)
      where x.change = 'Deleted' and coalesce(x.code, '') <> ''
      on conflict (code_set, code) do update set retired = true, retired_on = coalesce(t.retired_on, excluded.retired_on), change_flag = 'deleted',
        updated_by = excluded.updated_by, updated_at = now()
      where t.fiscal_year is distinct from $2
      $f$, m || 'ref_codes') using p_rows, p_fy, v_from, v_owner, p_file;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;
  return jsonb_build_object('ok', true, 'saved', n);
end;
$$;
revoke all on function rcm.owner_icd_import_batch(text, text, text, int, text, jsonb) from public;
grant execute on function rcm.owner_icd_import_batch(text, text, text, int, text, jsonb) to anon, authenticated;

-- Codes of the master's ICD-10 list that are not in the new year → retired from the start of that year (never deleted)
create or replace function rcm.owner_icd_retire_missing(p_by_user text, p_by_password text, p_fy int)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m text := (select prefix from rcm.companies where is_master);
  n int;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if m is null then return jsonb_build_object('ok', false, 'error', 'no_master'); end if;
  perform set_config('helix.bulk_import', 'on', true);
  execute format('update rcm.%I set retired = true, retired_on = coalesce(retired_on, $2), updated_by = $3, updated_at = now()
                  where code_set = ''icd10'' and not retired and fiscal_year is distinct from $1', m || 'ref_codes')
    using p_fy, make_date(p_fy - 1, 10, 1), upper(trim(p_by_user));
  get diagnostics n = row_count;
  perform rcm._owner_log(upper(trim(p_by_user)), 'icd_import', 'MASTER', format('ICD-10-CM FY%s: retired codes not in the file', p_fy),
                         jsonb_build_object('fiscal_year', p_fy, 'retired', n));
  return jsonb_build_object('ok', true, 'retired', n);
end;
$$;
revoke all on function rcm.owner_icd_retire_missing(text, text, int) from public;
grant execute on function rcm.owner_icd_retire_missing(text, text, int) to anon, authenticated;

-- One owner-log line per imported file
create or replace function rcm.owner_icd_import_done(p_by_user text, p_by_password text, p_fy int, p_file text, p_details jsonb)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  perform rcm._owner_log(upper(trim(p_by_user)), 'icd_import', 'MASTER', format('ICD-10-CM FY%s: %s', p_fy, p_file), coalesce(p_details, '{}'::jsonb));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function rcm.owner_icd_import_done(text, text, int, text, jsonb) from public;
grant execute on function rcm.owner_icd_import_done(text, text, int, text, jsonb) to anon, authenticated;

-- 6 ── PDFs in sop-media (Official Guidelines) ───────────────────────────────────
update storage.buckets set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
where id = 'sop-media' and allowed_mime_types is not null and not ('application/pdf' = any(allowed_mime_types));

-- 7 ── rules: the usual company rules, then companies may read the master's new tables ───
select rcm.protect_all_tables();
do $$
declare
  m text := (select prefix from rcm.companies where is_master);
  t text;
begin
  if m is null then return; end if;
  foreach t in array array['icd_notes', 'icd_index', 'icd_changes', 'sop_documents'] loop
    if not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = m || t and policyname = 'helix_library_read') then
      execute format('create policy helix_library_read on rcm.%I for select to anon, authenticated using ((select rcm._any_session()))', m || t);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
