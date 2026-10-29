-- ═══════════════════════════════════════════════════════════════════════════
-- Owner Console 2.0 (PO request 2026-10-29) — the Helix Hub owner decides which pages each company gets, pauses a
-- company's login, signs everyone out, shows banners / broadcasts, keeps private notes, manages several owner accounts
-- and has a log of every owner action.
-- Run once in Supabase → SQL Editor (after multi_company_setup.sql). Additive only; safe to re-run.
-- Afterwards click "↻ Sync structure" in the Owner Console.
--
--   • rcm.companies gets: features (page on / off map, {} = everything on), plan, seat_limit, pause_message, banner,
--     session_version (raised to sign everyone out), updated_at. The login screen already reads this table.
--   • helix_company_private (contact person / notes) and helix_owner_log are owner-only: no API access at all,
--     read and written only through the owner functions below (each checks the owner password).
--   • helix_broadcasts: banners for all / chosen companies — readable by the app, written only by the owner.
--   • _home_tables now also skips helix_* tables, so "Sync structure" never copies owner data into a company.
--   • No patient data anywhere. Nothing is deleted.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Company settings (readable by the app, changed only by the owner functions) ──
alter table rcm.companies add column if not exists features        jsonb       not null default '{}'::jsonb;
alter table rcm.companies add column if not exists plan            text;
alter table rcm.companies add column if not exists seat_limit      int;
alter table rcm.companies add column if not exists pause_message   text;
alter table rcm.companies add column if not exists banner          jsonb;      -- { text, kind: info|warning|maintenance }
alter table rcm.companies add column if not exists session_version int         not null default 1;
alter table rcm.companies add column if not exists updated_at      timestamptz;

-- ── Owner-only tables ─────────────────────────────────────────────────────────
create table if not exists rcm.helix_company_private (
  code           text        primary key,          -- rcm.companies.code, or '__home__' for the home company
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  notes          text,
  updated_by     text,
  updated_at     timestamptz not null default now()
);
alter table rcm.helix_company_private enable row level security;
revoke all on rcm.helix_company_private from anon, authenticated;

create table if not exists rcm.helix_owner_log (
  id            bigint generated always as identity primary key,
  owner         text        not null,              -- helix_owners.username
  action        text        not null,
  company_code  text,                              -- '__home__' = home company
  target        text,                              -- e.g. the user signed in as
  details       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists helix_owner_log_created_idx on rcm.helix_owner_log (created_at desc);
alter table rcm.helix_owner_log enable row level security;
revoke all on rcm.helix_owner_log from anon, authenticated;

create table if not exists rcm.helix_broadcasts (
  id          bigint generated always as identity primary key,
  title       text        not null,
  body        text,
  kind        text        not null default 'info' check (kind in ('info', 'warning', 'maintenance')),
  companies   text[]      not null default '{}',   -- company codes ('__home__' = home); empty = every company
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table rcm.helix_broadcasts enable row level security;
drop policy if exists helix_broadcasts_read on rcm.helix_broadcasts;
create policy helix_broadcasts_read on rcm.helix_broadcasts for select to anon, authenticated using (true);
revoke all on rcm.helix_broadcasts from anon, authenticated;
grant select on rcm.helix_broadcasts to anon, authenticated;

-- ── Sync never copies owner tables into a company ─────────────────────────────
create or replace view rcm._home_tables as
  select c.relname::text as name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'rcm' and c.relkind = 'r'
    and c.relname not in ('companies', 'helix_owners')
    and c.relname not like 'co\_%'
    and c.relname not like 'helix\_%';
revoke all on rcm._home_tables from anon, authenticated;

-- ── Owner log (internal) ──────────────────────────────────────────────────────
create or replace function rcm._owner_log(p_owner text, p_action text, p_code text, p_target text, p_details jsonb)
returns void
language sql security definer
set search_path = rcm, pg_temp
as $$
  insert into rcm.helix_owner_log (owner, action, company_code, target, details)
  values (upper(trim(p_owner)), p_action, p_code, p_target, p_details);
$$;
revoke all on function rcm._owner_log(text, text, text, text, jsonb) from public, anon, authenticated;

-- ── Company settings: features, plan, seats, banner (only keys present are changed) ──
create or replace function rcm.owner_company_settings(p_by_user text, p_by_password text, p_code text, p_settings jsonb)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised: only the Helix Hub owner can change company settings';
  end if;
  update rcm.companies set
    features   = case when p_settings ? 'features'   then coalesce(p_settings->'features', '{}'::jsonb) else features end,
    plan       = case when p_settings ? 'plan'       then nullif(trim(p_settings->>'plan'), '') else plan end,
    seat_limit = case when p_settings ? 'seat_limit' then nullif(p_settings->>'seat_limit', '')::int else seat_limit end,
    banner     = case when p_settings ? 'banner'     then nullif(p_settings->'banner', 'null'::jsonb) else banner end,
    updated_at = now()
  where code = upper(p_code);
  if not found then
    raise exception 'Company not found';
  end if;
  perform rcm._owner_log(p_by_user, 'company_settings', upper(p_code), null,
    jsonb_build_object('changed', (select jsonb_agg(k) from jsonb_object_keys(p_settings) k)));
end;
$$;
revoke all on function rcm.owner_company_settings(text, text, text, jsonb) from public;
grant execute on function rcm.owner_company_settings(text, text, text, jsonb) to anon, authenticated;

-- ── Pause / resume a company's login (pausing also signs everyone out) ────────
create or replace function rcm.owner_pause_company(p_by_user text, p_by_password text, p_code text, p_paused boolean, p_message text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised: only the Helix Hub owner can pause companies';
  end if;
  update rcm.companies set
    active          = not p_paused,
    pause_message   = case when p_paused then nullif(trim(p_message), '') else pause_message end,
    session_version = case when p_paused then session_version + 1 else session_version end,
    updated_at      = now()
  where code = upper(p_code);
  if not found then
    raise exception 'Company not found';
  end if;
  perform rcm._owner_log(p_by_user, case when p_paused then 'company_pause' else 'company_resume' end, upper(p_code), null,
    case when p_paused then jsonb_build_object('message', nullif(trim(p_message), '')) else null end);
end;
$$;
revoke all on function rcm.owner_pause_company(text, text, text, boolean, text) from public;
grant execute on function rcm.owner_pause_company(text, text, text, boolean, text) to anon, authenticated;

-- ── Sign everyone in a company out (their app checks session_version every few minutes) ──
create or replace function rcm.owner_force_signout(p_by_user text, p_by_password text, p_code text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised: only the Helix Hub owner can sign a company out';
  end if;
  update rcm.companies set session_version = session_version + 1, updated_at = now() where code = upper(p_code);
  if not found then
    raise exception 'Company not found';
  end if;
  perform rcm._owner_log(p_by_user, 'company_signout_all', upper(p_code), null, null);
end;
$$;
revoke all on function rcm.owner_force_signout(text, text, text) from public;
grant execute on function rcm.owner_force_signout(text, text, text) to anon, authenticated;

-- ── Private company details (contact person, notes) ───────────────────────────
create or replace function rcm.owner_private_list(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(p)) from rcm.helix_company_private p), '[]'::jsonb);
end;
$$;
revoke all on function rcm.owner_private_list(text, text) from public;
grant execute on function rcm.owner_private_list(text, text) to anon, authenticated;

create or replace function rcm.owner_private_save(p_by_user text, p_by_password text, p_code text, p_data jsonb)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  insert into rcm.helix_company_private (code, contact_name, contact_email, contact_phone, notes, updated_by, updated_at)
  values (p_code, nullif(trim(p_data->>'contact_name'), ''), nullif(trim(p_data->>'contact_email'), ''),
          nullif(trim(p_data->>'contact_phone'), ''), nullif(trim(p_data->>'notes'), ''), upper(trim(p_by_user)), now())
  on conflict (code) do update set
    contact_name = excluded.contact_name, contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone, notes = excluded.notes,
    updated_by = excluded.updated_by, updated_at = now();
  perform rcm._owner_log(p_by_user, 'company_private_save', p_code, null, null);
end;
$$;
revoke all on function rcm.owner_private_save(text, text, text, jsonb) from public;
grant execute on function rcm.owner_private_save(text, text, text, jsonb) to anon, authenticated;

-- ── Owner log: record an action done in the app (sign in as, password reset…) and read the log ──
create or replace function rcm.owner_log_action(p_by_user text, p_by_password text, p_action text, p_code text, p_target text, p_details jsonb)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  perform rcm._owner_log(p_by_user, left(p_action, 60), p_code, left(p_target, 200), p_details);
end;
$$;
revoke all on function rcm.owner_log_action(text, text, text, text, text, jsonb) from public;
grant execute on function rcm.owner_log_action(text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function rcm.owner_log_list(p_by_user text, p_by_password text, p_limit int default 200)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(l) order by l.created_at desc)
    from (select * from rcm.helix_owner_log order by created_at desc limit least(greatest(p_limit, 1), 1000)) l
  ), '[]'::jsonb);
end;
$$;
revoke all on function rcm.owner_log_list(text, text, int) from public;
grant execute on function rcm.owner_log_list(text, text, int) to anon, authenticated;

-- ── Owner accounts ────────────────────────────────────────────────────────────
create or replace function rcm.owner_list_owners(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('username', o.username, 'name', o.name, 'active', o.active, 'created_at', o.created_at)
                     order by o.created_at)
    from rcm.helix_owners o
  ), '[]'::jsonb);
end;
$$;
revoke all on function rcm.owner_list_owners(text, text) from public;
grant execute on function rcm.owner_list_owners(text, text) to anon, authenticated;

create or replace function rcm.owner_add_owner(p_by_user text, p_by_password text, p_username text, p_name text, p_password text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user text := upper(regexp_replace(coalesce(p_username, ''), '[^A-Za-z0-9_]', '', 'g'));
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  if length(v_user) < 3 then
    raise exception 'Username must be at least 3 letters or numbers';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  if exists (select 1 from rcm.helix_owners where username = v_user) then
    raise exception 'That owner username already exists';
  end if;
  insert into rcm.helix_owners (username, name, password)
  values (v_user, coalesce(nullif(trim(p_name), ''), 'Helix Hub Owner'), p_password);
  perform rcm._owner_log(p_by_user, 'owner_add', null, v_user, null);
end;
$$;
revoke all on function rcm.owner_add_owner(text, text, text, text, text) from public;
grant execute on function rcm.owner_add_owner(text, text, text, text, text) to anon, authenticated;

create or replace function rcm.owner_set_owner_active(p_by_user text, p_by_password text, p_username text, p_active boolean)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  if upper(trim(p_username)) = upper(trim(p_by_user)) and not p_active then
    raise exception 'You can''t switch off your own owner account';
  end if;
  update rcm.helix_owners set active = p_active where username = upper(trim(p_username));
  if not found then
    raise exception 'Owner not found';
  end if;
  perform rcm._owner_log(p_by_user, case when p_active then 'owner_activate' else 'owner_deactivate' end, null, upper(trim(p_username)), null);
end;
$$;
revoke all on function rcm.owner_set_owner_active(text, text, text, boolean) from public;
grant execute on function rcm.owner_set_owner_active(text, text, text, boolean) to anon, authenticated;

-- ── Broadcasts: add (p_id null) or change one ─────────────────────────────────
create or replace function rcm.owner_broadcast_save(p_by_user text, p_by_password text, p_id bigint, p_data jsonb)
returns bigint
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_id bigint;
  v_companies text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'companies', '[]'::jsonb)) x), '{}');
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  if nullif(trim(p_data->>'title'), '') is null then
    raise exception 'A broadcast needs a title';
  end if;
  if p_id is null then
    insert into rcm.helix_broadcasts (title, body, kind, companies, starts_at, ends_at, active, created_by)
    values (trim(p_data->>'title'), nullif(trim(p_data->>'body'), ''), coalesce(nullif(p_data->>'kind', ''), 'info'), v_companies,
            coalesce(nullif(p_data->>'starts_at', '')::timestamptz, now()), nullif(p_data->>'ends_at', '')::timestamptz,
            coalesce((p_data->>'active')::boolean, true), upper(trim(p_by_user)))
    returning id into v_id;
  else
    update rcm.helix_broadcasts set
      title = trim(p_data->>'title'), body = nullif(trim(p_data->>'body'), ''), kind = coalesce(nullif(p_data->>'kind', ''), 'info'),
      companies = v_companies, starts_at = coalesce(nullif(p_data->>'starts_at', '')::timestamptz, starts_at),
      ends_at = nullif(p_data->>'ends_at', '')::timestamptz, active = coalesce((p_data->>'active')::boolean, active),
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Broadcast not found';
    end if;
  end if;
  perform rcm._owner_log(p_by_user, case when p_id is null then 'broadcast_add' else 'broadcast_edit' end, null, v_id::text,
    jsonb_build_object('title', trim(p_data->>'title'), 'companies', to_jsonb(v_companies)));
  return v_id;
end;
$$;
revoke all on function rcm.owner_broadcast_save(text, text, bigint, jsonb) from public;
grant execute on function rcm.owner_broadcast_save(text, text, bigint, jsonb) to anon, authenticated;

-- ── Structure check: what "Sync structure" would add, per company (changes nothing) ──
create or replace function rcm.owner_structure_status(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  co     record;
  t      record;
  v_out  jsonb := '[]'::jsonb;
  v_tab  int;
  v_col  int;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  for co in select code, prefix from rcm.companies loop
    v_tab := 0; v_col := 0;
    for t in select name from rcm._home_tables loop
      if to_regclass(format('rcm.%I', co.prefix || t.name)) is null then
        v_tab := v_tab + 1;
      else
        v_col := v_col + (
          select count(*) from pg_attribute a
          where a.attrelid = format('rcm.%I', t.name)::regclass and a.attnum > 0 and not a.attisdropped
            and not exists (select 1 from pg_attribute b
                            where b.attrelid = format('rcm.%I', co.prefix || t.name)::regclass
                              and b.attname = a.attname and not b.attisdropped));
      end if;
    end loop;
    v_out := v_out || jsonb_build_object('code', co.code, 'missing_tables', v_tab, 'missing_columns', v_col);
  end loop;
  return v_out;
end;
$$;
revoke all on function rcm.owner_structure_status(text, text) from public;
grant execute on function rcm.owner_structure_status(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
