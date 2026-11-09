-- ═══════════════════════════════════════════════════════════════════════════
-- Master copy (PO request 2026-11-09), Stage 1. Migration 47.
-- Run once in Supabase → SQL Editor. Additive only (new columns, a hidden workspace, new functions); safe to re-run.
--
--   • companies.is_master — marks the hidden "Master copy" workspace (code MASTER, prefix co_master__). It gets its own
--     copy of every table like any company, has no users, and the app keeps it off the login screen and every company list.
--     The owner opens it from Command Center → Master Data → "Edit master copy" and edits it with the normal pages.
--   • master_id / master_pushed_at on the tables a push will fill (home + every company + the master):
--     master_id = the master row a company row came from (null = the company's own row, never touched by a push);
--     master_pushed_at = when it was last pushed (later company edits are kept). Used from Stage 2.
--     NOT payers.source / denial_codes.source / ref_codes.source — those already say where a row came from.
--   • owner_master_seed — one-time "Start from 3Gen's lists": copies the home company's payer directory, denial guides,
--     code lists, SOP library and task targets into the EMPTY master. Home rows are not changed. Client-specific rows
--     (client limits, client denial steps, client SOPs) and files (payer forms, SOP media: Stage 3) are not copied.
-- ═══════════════════════════════════════════════════════════════════════════

alter table rcm.companies add column if not exists is_master boolean not null default false;

-- Tables a master copy covers, parents before children
create or replace function rcm._master_tables()
returns text[]
language sql immutable
as $$
  select array['payers', 'payer_plans', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_notes', 'payer_auth_rules', 'payer_forms',
               'sop_categories', 'sop_software', 'sop_tasks', 'sops', 'sop_media',
               'denial_codes', 'denial_steps', 'ref_codes', 'task_configs'];
$$;

-- ── master_id / master_pushed_at in home + every company (the master is cloned from home below, so it gets them too) ──
do $$
declare
  v_prefix text;
  t        text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    foreach t in array rcm._master_tables() loop
      if to_regclass(format('rcm.%I', v_prefix || t)) is not null then
        execute format('alter table rcm.%I add column if not exists master_id bigint', v_prefix || t);
        execute format('alter table rcm.%I add column if not exists master_pushed_at timestamptz', v_prefix || t);
      end if;
    end loop;
  end loop;
end;
$$;

-- ── The hidden master workspace ─────────────────────────────────────────────
do $$
declare
  t record;
begin
  if exists (select 1 from rcm.companies where is_master) then return; end if;
  if exists (select 1 from rcm.companies where upper(code) = 'MASTER' or prefix = 'co_master__') then
    raise exception 'A company already uses the code MASTER — rename it first';
  end if;
  for t in select name from rcm._home_tables loop
    if to_regclass(format('rcm.%I', 'co_master__' || t.name)) is null then
      perform rcm._clone_table(t.name, 'co_master__' || t.name);
    end if;
  end loop;
  grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;
  insert into rcm.companies (name, code, prefix, created_by, is_master) values ('Master copy', 'MASTER', 'co_master__', 'SYSTEM', true);
end;
$$;

-- ── Copy one table between two prefixes, keeping links between rows (internal) ─────
-- p_fks: {"payer_id": "payers", …} — each link is pointed at the copied parent (found by master_id = the source id).
-- Copied rows get master_id = the source row's id; the caller decides what master_id should finally hold.
create or replace function rcm._master_copy_table(p_src text, p_dst text, p_table text, p_fks jsonb, p_where text default 'true')
returns int
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_cols  text;
  v_sel   text;
  v_has_id boolean;
  v_n     int;
begin
  if to_regclass(format('rcm.%I', p_src || p_table)) is null or to_regclass(format('rcm.%I', p_dst || p_table)) is null then
    return 0;
  end if;
  select exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = p_src || p_table and column_name = 'id')
    into v_has_id;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(case
                      when p_fks ? c.column_name then
                        format('(select d.id from rcm.%I d where d.master_id = s.%I)', p_dst || (p_fks->>c.column_name), c.column_name)
                      when c.column_name = 'copied_from' then 'null'
                      else format('s.%I', c.column_name)
                    end, ', ' order by c.ordinal_position)
    into v_cols, v_sel
  from information_schema.columns c
  where c.table_schema = 'rcm' and c.table_name = p_dst || p_table
    and c.column_name not in ('id', 'master_id', 'master_pushed_at')
    and exists (select 1 from information_schema.columns s
                where s.table_schema = 'rcm' and s.table_name = p_src || p_table and s.column_name = c.column_name);

  if v_has_id then
    execute format('insert into rcm.%I (%s, master_id) select %s, s.id from rcm.%I s where %s',
                   p_dst || p_table, v_cols, v_sel, p_src || p_table, p_where);
  else
    execute format('insert into rcm.%I (%s) select %s from rcm.%I s where %s',
                   p_dst || p_table, v_cols, v_sel, p_src || p_table, p_where);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function rcm._master_copy_table(text, text, text, jsonb, text) from public, anon, authenticated;

-- What each master table links to, and which rows belong in a master copy (no client-specific rows)
create or replace function rcm._master_spec()
returns table (tbl text, fks jsonb, filter text)
language sql immutable
as $$
  values
    ('payers',           '{}'::jsonb,                                                         'true'),
    ('payer_plans',      '{"payer_id": "payers"}'::jsonb,                                     'true'),
    ('payer_ids',        '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb,           'true'),
    ('payer_contacts',   '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb,           'true'),
    ('payer_limits',     '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb,           's.client_id is null'),
    ('payer_notes',      '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb,           'true'),
    ('payer_auth_rules', '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb,           'true'),
    ('sop_categories',   '{}'::jsonb,                                                         'true'),
    ('sop_software',     '{"category_id": "sop_categories"}'::jsonb,                          'true'),
    ('sop_tasks',        '{"software_id": "sop_software"}'::jsonb,                            'true'),
    ('sops',             '{"task_id": "sop_tasks"}'::jsonb,                                   's.client_id is null'),
    ('denial_codes',     '{}'::jsonb,                                                         'true'),
    ('denial_steps',     '{"code_id": "denial_codes", "payer_id": "payers", "sop_id": "sops"}'::jsonb, 's.client_id is null and s.scope <> ''client'''),
    ('ref_codes',        '{}'::jsonb,                                                         'true'),
    ('task_configs',     '{}'::jsonb,                                                         'true');
$$;

-- ── Master copy status: rows per list ───────────────────────────────────────
create or replace function rcm.owner_master_status(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m     rcm.companies;
  s     record;
  v_out jsonb := '{}'::jsonb;
  v_n   int;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  select * into m from rcm.companies where is_master;
  if not found then return jsonb_build_object('exists', false); end if;
  for s in select tbl from rcm._master_spec() loop
    v_n := 0;
    if to_regclass(format('rcm.%I', m.prefix || s.tbl)) is not null then
      execute format('select count(*) from rcm.%I', m.prefix || s.tbl) into v_n;
    end if;
    v_out := v_out || jsonb_build_object(s.tbl, v_n);
  end loop;
  return jsonb_build_object('exists', true, 'code', m.code, 'prefix', m.prefix, 'name', m.name, 'counts', v_out);
end;
$$;
revoke all on function rcm.owner_master_status(text, text) from public;
grant execute on function rcm.owner_master_status(text, text) to anon, authenticated;

-- ── One-time "Start from 3Gen's lists" (only into an empty master) ─────────────
create or replace function rcm.owner_master_seed(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m     rcm.companies;
  s     record;
  v_out jsonb := '{}'::jsonb;
  v_n   int;
  v_any int := 0;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  select * into m from rcm.companies where is_master;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_master'); end if;
  for s in select tbl from rcm._master_spec() loop
    if to_regclass(format('rcm.%I', m.prefix || s.tbl)) is not null then
      execute format('select count(*) from rcm.%I', m.prefix || s.tbl) into v_n;
      v_any := v_any + v_n;
    end if;
  end loop;
  if v_any > 0 then return jsonb_build_object('ok', false, 'error', 'not_empty'); end if;

  for s in select * from rcm._master_spec() loop
    v_n := rcm._master_copy_table('', m.prefix, s.tbl, s.fks, s.filter);
    v_out := v_out || jsonb_build_object(s.tbl, v_n);
  end loop;
  -- master_id only held the 3Gen row ids while links were rebuilt; master rows are originals, so it is cleared
  for s in select tbl from rcm._master_spec() loop
    if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = m.prefix || s.tbl and column_name = 'master_id') then
      execute format('update rcm.%I set master_id = null where master_id is not null', m.prefix || s.tbl);
    end if;
  end loop;

  perform rcm._owner_log(p_by_user, 'master_seed', m.code, 'Started from 3Gen''s lists', v_out);
  return jsonb_build_object('ok', true, 'copied', v_out);
end;
$$;
revoke all on function rcm.owner_master_seed(text, text) from public;
grant execute on function rcm.owner_master_seed(text, text) to anon, authenticated;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
