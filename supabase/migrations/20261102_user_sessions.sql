-- ═══════════════════════════════════════════════════════════════════════════
-- Security stage 2 — signed-in sessions (PO approved 2026-10-31)
-- Run once in Supabase → SQL Editor. Additive; safe to re-run. No "Sync structure" needed.
--
--   • Scrambled passwords move out of every company's users.password into one locked table (helix_user_passwords)
--     that the app's public key can't read. The column stays (set empty). Everyone keeps their password.
--   • The stage-1 trigger now saves any new password into the locked table, so Team, Profile, password resets,
--     "Add company" and the Owner Console keep working unchanged.
--   • Signing in gives a 12-hour session key (helix_user_sessions). The app sends it with every request
--     (header x-helix-session); rcm.current_session() tells the database who is asking — stage 3 builds on this.
--   • 5 wrong passwords for one ID within 15 minutes → that ID is locked for 15 minutes (helix_login_attempts).
--   • Sessions end on sign-out, when a user is switched off or their password is changed (except the session that
--     changed it), and when the owner uses "Sign everyone out" for a company.
--   • helix_* tables are never copied into companies and the public key has no access to them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Locked tables ───────────────────────────────────────────────────────────
create table if not exists rcm.helix_user_passwords (
  prefix      text        not null,           -- '' = home company
  emp_id      text        not null,
  hash        text        not null,
  updated_at  timestamptz not null default now(),
  primary key (prefix, emp_id)
);
create table if not exists rcm.helix_user_sessions (
  token       text        primary key,
  prefix      text        not null,
  emp_id      text        not null,
  role        text,
  as_owner    text,                           -- set when a Helix Hub owner opened the company
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  last_seen   timestamptz not null default now()
);
create index if not exists helix_user_sessions_user on rcm.helix_user_sessions (prefix, emp_id);
create table if not exists rcm.helix_login_attempts (
  id          bigint      generated always as identity primary key,
  prefix      text        not null,
  emp_id      text        not null,
  at          timestamptz not null default now()
);
create index if not exists helix_login_attempts_user on rcm.helix_login_attempts (prefix, emp_id, at);

alter table rcm.helix_user_passwords  enable row level security;
alter table rcm.helix_user_sessions   enable row level security;
alter table rcm.helix_login_attempts  enable row level security;
revoke all on rcm.helix_user_passwords, rcm.helix_user_sessions, rcm.helix_login_attempts from anon, authenticated;

-- ── Trigger: new passwords go to the locked table ───────────────────────────
-- Owners (helix_owners) keep their scrambled password in place, as in stage 1.
create or replace function rcm._hash_password_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text;
  v_hash   text;
  v_me     text;
begin
  if tg_table_name = 'helix_owners' then
    if new.password is not null and new.password <> '' and new.password !~ '^\$2[abxy]\$'
       and (tg_op = 'INSERT' or new.password is distinct from old.password) then
      new.password := extensions.crypt(new.password, extensions.gen_salt('bf', 10));
    end if;
    return new;
  end if;

  v_prefix := left(tg_table_name, length(tg_table_name) - length('users'));
  if new.password is not null and new.password <> ''
     and (tg_op = 'INSERT' or new.password is distinct from old.password) then
    v_hash := case when new.password ~ '^\$2[abxy]\$' then new.password
                   else extensions.crypt(new.password, extensions.gen_salt('bf', 10)) end;
    insert into rcm.helix_user_passwords (prefix, emp_id, hash, updated_at)
    values (v_prefix, upper(new.emp_id), v_hash, now())
    on conflict (prefix, emp_id) do update set hash = excluded.hash, updated_at = now();
    if tg_op = 'UPDATE' then
      -- Password changed: end this person's other sessions (keep the one that made the change)
      v_me := nullif(current_setting('request.headers', true), '')::json->>'x-helix-session';
      delete from rcm.helix_user_sessions
       where prefix = v_prefix and emp_id = upper(new.emp_id) and token is distinct from v_me;
    end if;
    new.password := '';
  end if;
  return new;
end;
$$;
revoke all on function rcm._hash_password_trg() from public, anon, authenticated;

-- User switched off or renamed: end their sessions (and move the password with a renamed ID)
create or replace function rcm._user_change_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text := left(tg_table_name, length(tg_table_name) - length('users'));
begin
  if upper(new.emp_id) is distinct from upper(old.emp_id) then
    update rcm.helix_user_passwords set emp_id = upper(new.emp_id) where prefix = v_prefix and emp_id = upper(old.emp_id);
    delete from rcm.helix_user_sessions where prefix = v_prefix and emp_id = upper(old.emp_id);
  end if;
  if new.active is false and old.active is distinct from false then
    delete from rcm.helix_user_sessions where prefix = v_prefix and emp_id = upper(new.emp_id);
  end if;
  return null;
end;
$$;
revoke all on function rcm._user_change_trg() from public, anon, authenticated;

-- Adds both triggers to a users table (each skipped if already there); owners get only the scrambling one
create or replace function rcm._attach_password_trigger(p_table text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if to_regclass(format('rcm.%I', p_table)) is null then return; end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = format('rcm.%I', p_table)::regclass and tgname = 'hash_password') then
    execute format('create trigger hash_password before insert or update of password on rcm.%I
                    for each row execute function rcm._hash_password_trg()', p_table);
  end if;
  if p_table <> 'helix_owners'
     and exists (select 1 from information_schema.columns
                  where table_schema = 'rcm' and table_name = p_table and column_name = 'active')
     and not exists (select 1 from pg_trigger
                      where tgrelid = format('rcm.%I', p_table)::regclass and tgname = 'end_sessions') then
    execute format('create trigger end_sessions after update of emp_id, active on rcm.%I
                    for each row execute function rcm._user_change_trg()', p_table);
  end if;
end;
$$;
revoke all on function rcm._attach_password_trigger(text) from public, anon, authenticated;

-- Owner "Sign everyone out" (raises companies.session_version) also ends that company's sessions
create or replace function rcm._company_signout_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  delete from rcm.helix_user_sessions where prefix = new.prefix and as_owner is null;
  return null;
end;
$$;
revoke all on function rcm._company_signout_trg() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'rcm' and table_name = 'companies' and column_name = 'session_version')
     and not exists (select 1 from pg_trigger where tgrelid = 'rcm.companies'::regclass and tgname = 'end_company_sessions') then
    create trigger end_company_sessions after update of session_version on rcm.companies
      for each row when (new.session_version is distinct from old.session_version)
      execute function rcm._company_signout_trg();
  end if;
end $$;

-- ── Move scrambled passwords into the locked table (home + every company) ───
do $$
declare
  v_prefix text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'users')) is null then continue; end if;
    execute format(
      'insert into rcm.helix_user_passwords (prefix, emp_id, hash)
       select distinct on (upper(emp_id)) $1, upper(emp_id),
              case when password ~ ''^\$2[abxy]\$'' then password
                   else extensions.crypt(password, extensions.gen_salt(''bf'', 10)) end
         from rcm.%I where coalesce(password, '''') <> ''''
       on conflict (prefix, emp_id) do update set hash = excluded.hash, updated_at = now()',
      v_prefix || 'users') using v_prefix;
    execute format('update rcm.%I set password = '''' where coalesce(password, '''') <> ''''', v_prefix || 'users');
    perform rcm._attach_password_trigger(v_prefix || 'users');
  end loop;
end $$;

-- ── Sign in: checks the locked table + lockout, returns the user and a session key ──
create or replace function rcm.user_login(p_prefix text, p_emp_id text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text := coalesce(p_prefix, '');
  v_emp    text := upper(trim(coalesce(p_emp_id, '')));
  v_row    jsonb;
  v_hash   text;
  v_token  text;
begin
  if v_prefix <> '' and not exists (select 1 from rcm.companies where prefix = v_prefix) then return null; end if;
  if to_regclass(format('rcm.%I', v_prefix || 'users')) is null or coalesce(p_password, '') = '' or v_emp = '' then
    return null;
  end if;

  if (select count(*) from rcm.helix_login_attempts
       where prefix = v_prefix and emp_id = v_emp and at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many attempts. Try again in 15 minutes.';
  end if;

  execute format('select to_jsonb(u) from rcm.%I u where emp_id = $1 limit 1', v_prefix || 'users') into v_row using v_emp;
  select hash into v_hash from rcm.helix_user_passwords where prefix = v_prefix and emp_id = v_emp;

  if v_row is null or v_hash is null or v_hash <> extensions.crypt(p_password, v_hash) then
    delete from rcm.helix_login_attempts where at < now() - interval '1 day';
    insert into rcm.helix_login_attempts (prefix, emp_id) values (v_prefix, v_emp);
    return null;
  end if;

  delete from rcm.helix_login_attempts where prefix = v_prefix and emp_id = v_emp;
  v_row := v_row - 'password';
  if (v_row->>'active') = 'false' then return v_row; end if;   -- switched off: the app shows the message, no session

  delete from rcm.helix_user_sessions where expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into rcm.helix_user_sessions (token, prefix, emp_id, role, expires_at)
  values (v_token, v_prefix, v_emp, v_row->>'role', now() + interval '12 hours');
  return v_row || jsonb_build_object('session', v_token);
end;
$$;
revoke all on function rcm.user_login(text, text, text) from public;
grant execute on function rcm.user_login(text, text, text) to anon, authenticated;

create or replace function rcm.user_logout(p_token text)
returns void
language sql security definer
set search_path = rcm, pg_temp
as $$
  delete from rcm.helix_user_sessions where token = p_token;
$$;
revoke all on function rcm.user_logout(text) from public;
grant execute on function rcm.user_logout(text) to anon, authenticated;

-- Still valid? (not expired, user still exists and is switched on / owner still active)
create or replace function rcm.session_check(p_token text)
returns boolean
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  s    rcm.helix_user_sessions;
  v_ok boolean;
begin
  select * into s from rcm.helix_user_sessions where token = p_token and expires_at > now();
  if not found then return false; end if;
  if s.as_owner is not null then
    v_ok := exists (select 1 from rcm.helix_owners where username = s.as_owner and active);
  elsif to_regclass(format('rcm.%I', s.prefix || 'users')) is null then
    v_ok := false;
  else
    execute format('select exists (select 1 from rcm.%I where emp_id = $1 and active is not false)', s.prefix || 'users')
       into v_ok using s.emp_id;
  end if;
  if v_ok then update rcm.helix_user_sessions set last_seen = now() where token = p_token; end if;
  return v_ok;
end;
$$;
revoke all on function rcm.session_check(text) from public;
grant execute on function rcm.session_check(text) to anon, authenticated;

-- Who is asking (from the x-helix-session header) — for stage 3's row rules
create or replace function rcm.current_session()
returns rcm.helix_user_sessions
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select s.* from rcm.helix_user_sessions s
   where s.token = nullif(current_setting('request.headers', true), '')::json->>'x-helix-session'
     and s.expires_at > now();
$$;
revoke all on function rcm.current_session() from public;
grant execute on function rcm.current_session() to anon, authenticated;

-- Owner "Open →" (p_emp_id null = full admin) / "Sign in as" a user → a session marked as the owner's
create or replace function rcm.owner_open_session(p_by_user text, p_by_password text, p_prefix text, p_emp_id text)
returns text
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text := coalesce(p_prefix, '');
  v_emp    text := upper(trim(coalesce(p_emp_id, '')));
  v_role   text := 'admin';
  v_token  text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  if v_prefix <> '' and not exists (select 1 from rcm.companies where prefix = v_prefix) then
    raise exception 'Company not found';
  end if;
  if v_emp = '' then
    v_emp := 'HELIX_OWNER';
  else
    execute format('select role from rcm.%I where emp_id = $1', v_prefix || 'users') into v_role using v_emp;
  end if;
  delete from rcm.helix_user_sessions where expires_at < now();
  insert into rcm.helix_user_sessions (token, prefix, emp_id, role, as_owner, expires_at)
  values (v_token, v_prefix, v_emp, v_role, upper(trim(p_by_user)), now() + interval '12 hours');
  return v_token;
end;
$$;
revoke all on function rcm.owner_open_session(text, text, text, text) from public;
grant execute on function rcm.owner_open_session(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
