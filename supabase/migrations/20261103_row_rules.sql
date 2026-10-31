-- ═══════════════════════════════════════════════════════════════════════════
-- Security stage 3 — database row rules (PO approved 2026-10-31)
-- Run once in Supabase → SQL Editor. Additive (no tables/columns dropped, no data changed); safe to re-run.
-- No "Sync structure" needed.
--
--   • Every rcm table (home + every company copy) gets one rule: the request must carry a valid session for that
--     company (header x-helix-session, from sign-in) or a valid Helix Hub owner key (header x-helix-owner).
--     Without one, reads come back empty and saves are refused. A 3Gen session can't touch Test Co tables and back.
--   • Per-company switch (helix_rls_settings): 3Gen and Test Co start OFF (nothing changes until switched on);
--     companies added later start ON. Kill switch:
--       update rcm.helix_rls_settings set enforce = false where prefix = '';            -- 3Gen
--       update rcm.helix_rls_settings set enforce = false where prefix = 'co_testco__'; -- Test Co
--   • users: employees can change only their own name, photo, theme and password; supervisors can also reset other
--     people's passwords; admins, managers and people with the "Team management" grant can do everything.
--   • audit_log: add and read only — entries can't be changed or deleted.
--   • Before sign-in, only the 3Gen company name (rcm_store 'company_profile') is readable (the company step needs it).
--   • "Forgot password" creates a reset request (rcm.request_password_reset).
--   • Future migrations that add a table end with:  select rcm.protect_all_tables();
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Per-company switch (locked) ─────────────────────────────────────────────
create table if not exists rcm.helix_rls_settings (
  prefix      text        primary key,        -- '' = home company
  enforce     boolean     not null default true,
  updated_at  timestamptz not null default now()
);
alter table rcm.helix_rls_settings enable row level security;
revoke all on rcm.helix_rls_settings from anon, authenticated;

insert into rcm.helix_rls_settings (prefix, enforce)
select p, false from (select '' as p union all select prefix from rcm.companies) x
on conflict (prefix) do nothing;

-- ── Who is asking ───────────────────────────────────────────────────────────
create or replace function rcm._hdr(p_name text)
returns text
language sql stable
as $$
  select nullif(current_setting('request.headers', true), '')::json->>p_name;
$$;

create or replace function rcm._owner_key_ok()
returns boolean
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select exists (
    select 1 from rcm.helix_owner_sessions s
    join rcm.helix_owners o on o.username = s.username and o.active
    where s.token = rcm._hdr('x-helix-owner') and s.expires_at > now()
  );
$$;
revoke all on function rcm._owner_key_ok() from public;
grant execute on function rcm._owner_key_ok() to anon, authenticated;

-- The rule every table uses (evaluated once per query)
create or replace function rcm._allowed(p_prefix text)
returns boolean
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select not coalesce((select enforce from rcm.helix_rls_settings where prefix = p_prefix), true)
      or exists (select 1 from rcm.helix_user_sessions s
                  where s.token = rcm._hdr('x-helix-session') and s.prefix = p_prefix and s.expires_at > now())
      or rcm._owner_key_ok();
$$;
revoke all on function rcm._allowed(text) from public;
grant execute on function rcm._allowed(text) to anon, authenticated;

-- ── users: nobody can promote themselves ────────────────────────────────────
create or replace function rcm._guard_users_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix  text := left(tg_table_name, length(tg_table_name) - length('users'));
  s         rcm.helix_user_sessions;
  v_me      jsonb;
  v_role    text;
  v_changed text[];
begin
  if not coalesce((select enforce from rcm.helix_rls_settings where prefix = v_prefix), true) then return coalesce(new, old); end if;
  if rcm._owner_key_ok() then return coalesce(new, old); end if;
  s := rcm.current_session();
  if s.token is null or s.as_owner is not null then return coalesce(new, old); end if;   -- system / owner (no session = table rule refuses)

  execute format('select to_jsonb(u) from rcm.%I u where emp_id = $1', tg_table_name) into v_me using s.emp_id;
  v_role := coalesce(v_me->>'role', '');
  if v_role in ('admin', 'manager') or coalesce((v_me->'access_grants'->>'page_team')::boolean, false) then
    return coalesce(new, old);
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'Only an admin can add or remove users';
  end if;

  select coalesce(array_agg(e.key), '{}') into v_changed
    from jsonb_each(to_jsonb(new)) e where e.value is distinct from to_jsonb(old)->e.key;
  if upper(old.emp_id) = s.emp_id and upper(new.emp_id) = s.emp_id
     and v_changed <@ array['name', 'avatar_url', 'theme', 'password'] then
    return new;
  end if;
  if v_role = 'supervisor' and v_changed <@ array['password'] then
    return new;
  end if;
  raise exception 'You can only change your own name, photo and password';
end;
$$;
revoke all on function rcm._guard_users_trg() from public, anon, authenticated;

-- ── Put the rule on one table ───────────────────────────────────────────────
create or replace function rcm._protect_table(p_table text, p_prefix text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_base text := substr(p_table, length(p_prefix) + 1);
  v_rule text := format('(select rcm._allowed(%L))', p_prefix);
begin
  if to_regclass(format('rcm.%I', p_table)) is null then return; end if;
  execute format('alter table rcm.%I enable row level security', p_table);

  if v_base = 'audit_log' then
    if not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = p_table and policyname = 'helix_read') then
      execute format('create policy helix_read on rcm.%I for select to anon, authenticated using (%s)', p_table, v_rule);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = p_table and policyname = 'helix_add') then
      execute format('create policy helix_add on rcm.%I for insert to anon, authenticated with check (%s)', p_table, v_rule);
    end if;
  elsif not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = p_table and policyname = 'helix_session') then
    execute format('create policy helix_session on rcm.%I for all to anon, authenticated using (%s) with check (%s)',
                   p_table, v_rule, v_rule);
  end if;

  if p_table = 'rcm_store'
     and not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = p_table and policyname = 'helix_public_profile') then
    create policy helix_public_profile on rcm.rcm_store for select to anon, authenticated using (key = 'company_profile');
  end if;

  if v_base = 'users'
     and not exists (select 1 from pg_trigger where tgrelid = format('rcm.%I', p_table)::regclass and tgname = 'guard_users') then
    execute format('create trigger guard_users before insert or update or delete on rcm.%I
                    for each row execute function rcm._guard_users_trg()', p_table);
  end if;
end;
$$;
revoke all on function rcm._protect_table(text, text) from public, anon, authenticated;

-- Every home table + every company copy (skips owner tables and the registry)
create or replace function rcm.protect_all_tables()
returns int
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text;
  t        record;
  v_n      int := 0;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    for t in select name from rcm._home_tables loop
      if to_regclass(format('rcm.%I', v_prefix || t.name)) is not null then
        perform rcm._protect_table(v_prefix || t.name, v_prefix);
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke all on function rcm.protect_all_tables() from public, anon, authenticated;

-- Same as stage 2, but a company's copy gets the rule for that company (not the home company's)
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
    for pol in select * from pg_policies
                where schemaname = 'rcm' and tablename = p_src and policyname not like 'helix\_%' loop
      execute format('create policy %I on rcm.%I as %s for %s to %s %s %s',
        pol.policyname, p_dst, pol.permissive, pol.cmd,
        (select string_agg(quote_ident(r), ', ') from unnest(pol.roles) r),
        case when pol.qual       is not null then 'using (' || pol.qual || ')' else '' end,
        case when pol.with_check is not null then 'with check (' || pol.with_check || ')' else '' end);
    end loop;
  end if;

  if p_src = 'users' then
    perform rcm._attach_password_trigger(p_dst);
  end if;
  perform rcm._protect_table(p_dst, left(p_dst, length(p_dst) - length(p_src)));
end;
$$;
revoke all on function rcm._clone_table(text, text) from public, anon, authenticated;

-- ── "Forgot password" → a reset request for the admins / supervisors ────────
-- Says nothing about whether the ID exists. At most one pending request per person.
create or replace function rcm.request_password_reset(p_prefix text, p_emp_id text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix  text := coalesce(p_prefix, '');
  v_emp     text := upper(trim(coalesce(p_emp_id, '')));
  v_row     jsonb;
  v_pending boolean;
begin
  if v_emp = '' then return; end if;
  if v_prefix <> '' and not exists (select 1 from rcm.companies where prefix = v_prefix) then return; end if;
  if to_regclass(format('rcm.%I', v_prefix || 'users')) is null
     or to_regclass(format('rcm.%I', v_prefix || 'reset_requests')) is null then return; end if;

  execute format('select to_jsonb(u) from rcm.%I u where emp_id = $1', v_prefix || 'users') into v_row using v_emp;
  if v_row is null or (v_row->>'active') = 'false' then return; end if;
  execute format('select exists (select 1 from rcm.%I where emp_id = $1 and status = ''pending'')', v_prefix || 'reset_requests')
     into v_pending using v_emp;
  if v_pending then return; end if;
  execute format('insert into rcm.%I (emp_id, emp_name, status) values ($1, $2, ''pending'')', v_prefix || 'reset_requests')
    using v_emp, v_row->>'name';
end;
$$;
revoke all on function rcm.request_password_reset(text, text) from public;
grant execute on function rcm.request_password_reset(text, text) to anon, authenticated;

-- ── Apply to every table now ────────────────────────────────────────────────
select rcm.protect_all_tables();

notify pgrst, 'reload schema';
