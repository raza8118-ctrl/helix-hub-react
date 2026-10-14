-- ═══════════════════════════════════════════════════════════════════════════
-- Helix Hub — multi-company setup
-- Run in Supabase → SQL Editor (as the default postgres user).
-- Safe to re-run: it only (re)creates the registry/owner tables and functions.
--
-- How it works
--   • The home company keeps the original rcm tables.
--   • Each added company gets its own copy of every rcm table, named
--     co_<code>__<table>  (e.g. co_acme__daily_logs), so its users, targets,
--     processes, reports and settings are completely separate.
--   • Only a Helix Hub OWNER (rcm.helix_owners) can add, edit, deactivate, sync
--     or delete companies. Owners are separate from every company's users —
--     no company admin (3Gen's included) can manage companies. Owners sign in
--     from the "Helix Hub owner" link on the login screen.
--
-- After running this file, add your owner login once (pick your own password):
--   insert into rcm.helix_owners (username, name, password)
--   values ('OWNER', 'Your Name', 'your-password-here');
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Registry ────────────────────────────────────────────────────────────────
create table if not exists rcm.companies (
  id          bigint generated always as identity primary key,
  name        text        not null,
  code        text        not null unique,
  prefix      text        not null unique,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now()
);
create unique index if not exists companies_name_lower_key on rcm.companies (lower(name));

-- The login screen needs to read the registry; nobody writes it except the functions below.
alter table rcm.companies enable row level security;
drop policy if exists companies_read on rcm.companies;
create policy companies_read on rcm.companies for select to anon, authenticated using (true);
revoke all on rcm.companies from anon, authenticated;
grant select on rcm.companies to anon, authenticated;

-- ── Helix Hub owners (platform creators) ────────────────────────────────────
-- Never copied into companies and not readable through the public API —
-- only the functions below can see it.
create table if not exists rcm.helix_owners (
  username    text        primary key,
  name        text        not null default 'Helix Hub Owner',
  password    text        not null,
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);
alter table rcm.helix_owners enable row level security;
revoke all on rcm.helix_owners from anon, authenticated;

-- Earlier versions let any home-company admin manage companies — remove those.
drop function if exists rcm.create_company(text, text, text, text, text, text, text);
drop function if exists rcm.update_company(text, text, text, text, boolean);
drop function if exists rcm.sync_company_tables(text, text);
drop function if exists rcm._is_main_admin(text, text);

-- ── Owner check (internal) ──────────────────────────────────────────────────
create or replace function rcm._is_owner(p_username text, p_password text)
returns boolean
language sql security definer
set search_path = rcm, pg_temp
as $$
  select exists (
    select 1 from rcm.helix_owners
    where username = upper(trim(p_username))
      and password = p_password
      and active
  );
$$;
revoke all on function rcm._is_owner(text, text) from public, anon, authenticated;

-- ── Owner sign-in / password change ─────────────────────────────────────────
create or replace function rcm.owner_login(p_username text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  o rcm.helix_owners;
begin
  select * into o from rcm.helix_owners
   where username = upper(trim(p_username)) and password = p_password and active;
  if not found then
    raise exception 'Invalid owner username or password';
  end if;
  return jsonb_build_object('username', o.username, 'name', o.name);
end;
$$;
revoke all on function rcm.owner_login(text, text) from public;
grant execute on function rcm.owner_login(text, text) to anon, authenticated;

create or replace function rcm.owner_change_password(p_username text, p_password text, p_new_password text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_username, p_password) then
    raise exception 'Current password is incorrect';
  end if;
  if length(coalesce(p_new_password, '')) < 8 then
    raise exception 'New password must be at least 8 characters';
  end if;
  update rcm.helix_owners set password = p_new_password where username = upper(trim(p_username));
end;
$$;
revoke all on function rcm.owner_change_password(text, text, text) from public;
grant execute on function rcm.owner_change_password(text, text, text) to anon, authenticated;

-- ── Copy one home table's structure, grants and RLS policies (internal) ─────
create or replace function rcm._clone_table(p_src text, p_dst text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  pol record;
begin
  execute format('create table rcm.%I (like rcm.%I including all)', p_dst, p_src);
  execute format('grant select, insert, update, delete on rcm.%I to anon, authenticated, service_role', p_dst);

  if (select relrowsecurity from pg_class where oid = format('rcm.%I', p_src)::regclass) then
    execute format('alter table rcm.%I enable row level security', p_dst);
    for pol in select * from pg_policies where schemaname = 'rcm' and tablename = p_src loop
      execute format('create policy %I on rcm.%I as %s for %s to %s %s %s',
        pol.policyname, p_dst, pol.permissive, pol.cmd,
        (select string_agg(quote_ident(r), ', ') from unnest(pol.roles) r),
        case when pol.qual       is not null then 'using (' || pol.qual || ')' else '' end,
        case when pol.with_check is not null then 'with check (' || pol.with_check || ')' else '' end);
    end loop;
  end if;
end;
$$;
revoke all on function rcm._clone_table(text, text) from public, anon, authenticated;

-- Home tables that every company gets a copy of
create or replace view rcm._home_tables as
  select c.relname::text as name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'rcm' and c.relkind = 'r'
    and c.relname not in ('companies', 'helix_owners')
    and c.relname not like 'co\_%';
revoke all on rcm._home_tables from anon, authenticated;

-- ── Create a company ────────────────────────────────────────────────────────
create or replace function rcm.create_company(
  p_by_user        text,
  p_by_password    text,
  p_name           text,
  p_code           text,
  p_admin_id       text,
  p_admin_password text,
  p_admin_name     text default 'Administrator'
)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_prefix text;
  v_tables int := 0;
  v_admin  jsonb;
  v_cols   text;
  v_vals   text;
  t        record;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised: only the Helix Hub owner can add companies';
  end if;
  if v_name = '' then
    raise exception 'Company name is required';
  end if;
  if length(v_code) < 2 or length(v_code) > 16 then
    raise exception 'Company code must be 2–16 letters or numbers';
  end if;
  if trim(coalesce(p_admin_id, '')) = '' or length(coalesce(p_admin_password, '')) < 6 then
    raise exception 'First admin needs an ID and a password of at least 6 characters';
  end if;
  if exists (select 1 from rcm.companies where code = v_code or lower(name) = lower(v_name)) then
    raise exception 'A company with that name or code already exists';
  end if;

  v_prefix := 'co_' || lower(v_code) || '__';

  -- Copy the structure (columns, defaults, constraints, indexes, RLS) of every home table
  for t in select name from rcm._home_tables loop
    perform rcm._clone_table(t.name, v_prefix || t.name);
    v_tables := v_tables + 1;
  end loop;

  grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;

  -- The company's first admin login — only columns that exist in this users table are written
  v_admin := jsonb_build_object(
    'emp_id',   upper(trim(p_admin_id)),
    'name',     coalesce(nullif(trim(p_admin_name), ''), 'Administrator'),
    'password', p_admin_password,
    'role',     'admin',
    'access',   'ALL',
    'active',   'true');

  select string_agg(quote_ident(e.key), ', ' order by e.key),
         string_agg(quote_literal(e.value), ', ' order by e.key)
    into v_cols, v_vals
  from jsonb_each_text(v_admin) e
  where exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'rcm' and c.table_name = v_prefix || 'users' and c.column_name = e.key);

  if v_cols is null or v_cols not like '%emp\_id%' or v_cols not like '%password%' then
    raise exception 'The users table needs emp_id and password columns';
  end if;

  execute format('insert into rcm.%I (%s) values (%s)', v_prefix || 'users', v_cols, v_vals);

  insert into rcm.companies (name, code, prefix, created_by)
  values (v_name, v_code, v_prefix, upper(trim(p_by_user)));

  notify pgrst, 'reload schema';   -- make the new tables available to the API

  return jsonb_build_object('name', v_name, 'code', v_code, 'prefix', v_prefix, 'tables', v_tables);
end;
$$;
revoke all on function rcm.create_company(text, text, text, text, text, text, text) from public;
grant execute on function rcm.create_company(text, text, text, text, text, text, text) to anon, authenticated;

-- ── Rename / activate / deactivate a company ────────────────────────────────
create or replace function rcm.update_company(
  p_by_user     text,
  p_by_password text,
  p_code        text,
  p_name        text    default null,
  p_active      boolean default null
)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised: only the Helix Hub owner can change companies';
  end if;
  if nullif(trim(p_name), '') is not null and exists (
    select 1 from rcm.companies where lower(name) = lower(trim(p_name)) and code <> upper(p_code)
  ) then
    raise exception 'Another company already uses that name';
  end if;
  update rcm.companies
     set name   = coalesce(nullif(trim(p_name), ''), name),
         active = coalesce(p_active, active)
   where code = upper(p_code);
  if not found then
    raise exception 'Company not found';
  end if;
end;
$$;
revoke all on function rcm.update_company(text, text, text, text, boolean) from public;
grant execute on function rcm.update_company(text, text, text, text, boolean) to anon, authenticated;

-- ── Delete a company — drops ALL of its tables; cannot be undone ───────────
create or replace function rcm.delete_company(p_by_user text, p_by_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text;
  v_tables int := 0;
  t        record;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised: only the Helix Hub owner can delete companies';
  end if;
  select prefix into v_prefix from rcm.companies where code = upper(p_code);
  if v_prefix is null or v_prefix not like 'co\_%\_\_' then
    raise exception 'Company not found';
  end if;
  for t in
    select c.relname::text as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'rcm' and c.relkind = 'r'
      and left(c.relname, length(v_prefix)) = v_prefix
  loop
    execute format('drop table rcm.%I cascade', t.name);
    v_tables := v_tables + 1;
  end loop;
  delete from rcm.companies where code = upper(p_code);
  notify pgrst, 'reload schema';
  return jsonb_build_object('tables_dropped', v_tables);
end;
$$;
revoke all on function rcm.delete_company(text, text, text) from public;
grant execute on function rcm.delete_company(text, text, text) to anon, authenticated;

-- ── Sync: bring every company up to date with the home table structure ──────
-- Run after a Helix Hub update adds tables or columns to the home tables.
-- Only ADDS missing tables/columns; never drops or changes anything.
create or replace function rcm.sync_company_tables(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  co        record;
  t         record;
  col       record;
  v_dst     text;
  v_tables  int := 0;
  v_columns int := 0;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised: only the Helix Hub owner can sync companies';
  end if;

  for co in select prefix from rcm.companies loop
    for t in select name from rcm._home_tables loop
      v_dst := co.prefix || t.name;

      if to_regclass(format('rcm.%I', v_dst)) is null then
        perform rcm._clone_table(t.name, v_dst);
        v_tables := v_tables + 1;
      else
        for col in
          select a.attname,
                 format_type(a.atttypid, a.atttypmod) as typ,
                 pg_get_expr(d.adbin, d.adrelid)      as def
          from pg_attribute a
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = format('rcm.%I', t.name)::regclass
            and a.attnum > 0 and not a.attisdropped
            and not exists (
              select 1 from pg_attribute b
              where b.attrelid = format('rcm.%I', v_dst)::regclass
                and b.attname = a.attname and not b.attisdropped)
        loop
          execute format('alter table rcm.%I add column %I %s %s',
            v_dst, col.attname, col.typ,
            case when col.def is not null then 'default ' || col.def else '' end);
          v_columns := v_columns + 1;
        end loop;
      end if;
    end loop;
  end loop;

  grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;
  notify pgrst, 'reload schema';
  return jsonb_build_object('tables_created', v_tables, 'columns_added', v_columns);
end;
$$;
revoke all on function rcm.sync_company_tables(text, text) from public;
grant execute on function rcm.sync_company_tables(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
