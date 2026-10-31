-- ═══════════════════════════════════════════════════════════════════════════
-- Security stage 1 — quick wins (PO approved 2026-10-31)
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run. No "Sync structure" needed.
--
--   • Passwords are stored scrambled (bcrypt) instead of as plain text — for the home company, every added company
--     and the Helix Hub owners. Everyone keeps their current password: the same passwords still work.
--   • A database rule (trigger) scrambles any password saved from now on, so Team, Profile, the Owner Console and
--     "Add company" keep working unchanged. New companies get the rule automatically.
--   • rcm.user_login checks the password inside the database. The browser never receives a password any more.
--   • Owner Console sign-in gives a 12-hour session key; the browser no longer keeps the owner's password.
--   • Data clean-ups the PO said yes to: old temporary passwords saved in reset_requests are blanked; patient columns
--     are removed from Work Allocation lists already saved (rcm_store alloc_* + allocations.headers).
--     Rows themselves are kept. Nothing else is changed.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── Scramble any password that isn't scrambled yet (trigger) ────────────────
create or replace function rcm._hash_password_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if new.password is not null and new.password <> '' and new.password !~ '^\$2[abxy]\$'
     and (tg_op = 'INSERT' or new.password is distinct from old.password) then
    new.password := extensions.crypt(new.password, extensions.gen_salt('bf', 10));
  end if;
  return new;
end;
$$;
revoke all on function rcm._hash_password_trg() from public, anon, authenticated;

-- Adds the trigger to one table (skipped if it is already there)
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
end;
$$;
revoke all on function rcm._attach_password_trigger(text) from public, anon, authenticated;

-- Same as before, plus: a copied users table gets the trigger (covers "Add company" and "Sync structure")
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

  if p_src = 'users' then
    perform rcm._attach_password_trigger(p_dst);
  end if;
end;
$$;
revoke all on function rcm._clone_table(text, text) from public, anon, authenticated;

-- ── Scramble existing passwords + data clean-ups (home + every company) ─────
do $$
declare
  v_prefix text;
  v_type   text;
  -- Same patient-column rule as Smart Worklist (src/lib/worklist.js PHI_HEADER)
  v_phi    text := 'patient|member|subscriber|insured|beneficiary|\ydob\y|birth|\ymrn\y|medical\s*record|\yssn\y|social|address|street|city|\yzip\y|postal|phone|e-?mail|first\s*name|last\s*name|^name$|full\s*name|\ymbi\y|\yhicn\y|account\s*(#|no|num)';
begin
  update rcm.helix_owners
     set password = extensions.crypt(password, extensions.gen_salt('bf', 10))
   where password <> '' and password !~ '^\$2[abxy]\$';
  perform rcm._attach_password_trigger('helix_owners');

  for v_prefix in select '' union all select prefix from rcm.companies loop
    -- Passwords
    if to_regclass(format('rcm.%I', v_prefix || 'users')) is not null then
      execute format(
        'update rcm.%I set password = extensions.crypt(password, extensions.gen_salt(''bf'', 10))
          where password is not null and password <> '''' and password !~ ''^\$2[abxy]\$''',
        v_prefix || 'users');
      perform rcm._attach_password_trigger(v_prefix || 'users');
    end if;

    -- Old temporary passwords (PO yes, 2026-10-31)
    if exists (select 1 from information_schema.columns
                where table_schema = 'rcm' and table_name = v_prefix || 'reset_requests' and column_name = 'temp_password') then
      execute format('update rcm.%I set temp_password = null where temp_password is not null', v_prefix || 'reset_requests');
    end if;

    -- Patient columns in saved Work Allocation lists (PO yes, 2026-10-31)
    if to_regclass(format('rcm.%I', v_prefix || 'rcm_store')) is not null then
      execute format($f$
        update rcm.%I s set value = (
          select coalesce(jsonb_agg(
                   (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                      from jsonb_each(case when jsonb_typeof(r.elem) = 'object' then r.elem else '{}'::jsonb end) e
                     where trim(e.key) !~* $1)
                   order by r.ord), '[]'::jsonb)
            from jsonb_array_elements(s.value) with ordinality r(elem, ord))
        where s.key like 'alloc\_%%' and jsonb_typeof(s.value) = 'array'
          and exists (select 1 from jsonb_array_elements(s.value) x(elem),
                             jsonb_object_keys(case when jsonb_typeof(x.elem) = 'object' then x.elem else '{}'::jsonb end) k
                       where trim(k) ~* $1)$f$,
        v_prefix || 'rcm_store') using v_phi;
    end if;

    v_type := null;
    select data_type into v_type from information_schema.columns
     where table_schema = 'rcm' and table_name = v_prefix || 'allocations' and column_name = 'headers';
    if v_type = 'jsonb' then
      execute format($f$
        update rcm.%I set headers = (
          select coalesce(jsonb_agg(h order by o), '[]'::jsonb)
            from jsonb_array_elements(headers) with ordinality a(h, o) where trim(h #>> '{}') !~* $1)
        where jsonb_typeof(headers) = 'array'
          and exists (select 1 from jsonb_array_elements(headers) x(h) where trim(x.h #>> '{}') ~* $1)$f$,
        v_prefix || 'allocations') using v_phi;
    elsif v_type = 'ARRAY' then
      execute format($f$
        update rcm.%I set headers = array(
          select h from unnest(headers) with ordinality a(h, o) where trim(h) !~* $1 order by o)
        where exists (select 1 from unnest(headers) x(h) where trim(x.h) ~* $1)$f$,
        v_prefix || 'allocations') using v_phi;
    end if;
  end loop;
end $$;

-- ── Company sign-in: password checked here, never sent to the browser ───────
-- Returns the user row without the password, or null when the ID / password is wrong.
create or replace function rcm.user_login(p_prefix text, p_emp_id text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text := coalesce(p_prefix, '');
  v_row    jsonb;
  v_pw     text;
begin
  if v_prefix <> '' and not exists (select 1 from rcm.companies where prefix = v_prefix) then return null; end if;
  if to_regclass(format('rcm.%I', v_prefix || 'users')) is null or coalesce(p_password, '') = '' then return null; end if;

  execute format('select to_jsonb(u) from rcm.%I u where emp_id = $1 limit 1', v_prefix || 'users')
     into v_row using upper(trim(coalesce(p_emp_id, '')));
  if v_row is null then return null; end if;

  v_pw := v_row->>'password';
  if v_pw ~ '^\$2[abxy]\$' then
    if v_pw <> extensions.crypt(p_password, v_pw) then return null; end if;
  elsif v_pw is distinct from p_password then
    return null;
  else
    -- Saved before the trigger existed: scramble it now
    execute format('update rcm.%I set password = $1 where emp_id = $2', v_prefix || 'users')
      using extensions.crypt(p_password, extensions.gen_salt('bf', 10)), v_row->>'emp_id';
  end if;

  return v_row - 'password';
end;
$$;
revoke all on function rcm.user_login(text, text, text) from public;
grant execute on function rcm.user_login(text, text, text) to anon, authenticated;

-- ── Owner sign-in with 12-hour session keys ─────────────────────────────────
create table if not exists rcm.helix_owner_sessions (
  token       text        primary key,
  username    text        not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
alter table rcm.helix_owner_sessions enable row level security;
revoke all on rcm.helix_owner_sessions from anon, authenticated;

-- Password only (used for sign-in and changing the password)
create or replace function rcm._owner_password_ok(p_username text, p_password text)
returns boolean
language sql security definer
set search_path = rcm, pg_temp
as $$
  select exists (
    select 1 from rcm.helix_owners
    where username = upper(trim(p_username)) and active
      and password ~ '^\$2[abxy]\$'
      and password = extensions.crypt(coalesce(p_password, ''), password)
  );
$$;
revoke all on function rcm._owner_password_ok(text, text) from public, anon, authenticated;

-- Every owner function calls this with (username, key). The password still works too.
create or replace function rcm._is_owner(p_username text, p_password text)
returns boolean
language sql security definer
set search_path = rcm, pg_temp
as $$
  select rcm._owner_password_ok(p_username, p_password)
      or exists (
        select 1 from rcm.helix_owner_sessions s
        join rcm.helix_owners o on o.username = s.username and o.active
        where s.username = upper(trim(p_username)) and s.token = p_password and s.expires_at > now()
      );
$$;
revoke all on function rcm._is_owner(text, text) from public, anon, authenticated;

create or replace function rcm.owner_login(p_username text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  o       rcm.helix_owners;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not rcm._owner_password_ok(p_username, p_password) then
    raise exception 'Invalid owner username or password';
  end if;
  select * into o from rcm.helix_owners where username = upper(trim(p_username));
  delete from rcm.helix_owner_sessions where expires_at < now();   -- expired keys only
  insert into rcm.helix_owner_sessions (token, username, expires_at) values (v_token, o.username, now() + interval '12 hours');
  return jsonb_build_object('username', o.username, 'name', o.name, 'token', v_token);
end;
$$;
revoke all on function rcm.owner_login(text, text) from public;
grant execute on function rcm.owner_login(text, text) to anon, authenticated;

create or replace function rcm.owner_logout(p_username text, p_token text)
returns void
language sql security definer
set search_path = rcm, pg_temp
as $$
  delete from rcm.helix_owner_sessions where username = upper(trim(p_username)) and token = p_token;
$$;
revoke all on function rcm.owner_logout(text, text) from public;
grant execute on function rcm.owner_logout(text, text) to anon, authenticated;

-- Needs the current password (a session key is not enough); the trigger scrambles the new one
create or replace function rcm.owner_change_password(p_username text, p_password text, p_new_password text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._owner_password_ok(p_username, p_password) then
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

notify pgrst, 'reload schema';
