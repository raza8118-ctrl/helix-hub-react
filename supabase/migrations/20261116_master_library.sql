-- ═══════════════════════════════════════════════════════════════════════════
-- Master Library (PO request 2026-11-10), Stage 1. Migration 51.
-- Run once in Supabase → SQL Editor. Additive only: new read rules, one history table, new functions / triggers. Safe to re-run.
--
--   The hidden Master copy workspace (co_master__…, migration 47) becomes the shared Master Library:
--   • Every signed-in company user may READ its payer, denial, SOP and code-list tables (and the master's files in the
--     co_master/ storage folder). Writing stays owner-only (the existing rules allow only the owner key there).
--   • Change history: every add / change / remove of a master row → rcm.helix_master_changes (before, after, who, when).
--     The owner log gets ONE line per save or import ("master_change" with how many rows were added / changed / removed).
--   • owner_master_history(area) lists the latest changes for Payers / Denials / SOPs / Code lists.
-- ═══════════════════════════════════════════════════════════════════════════

-- Tables in the Master Library, by area
create or replace function rcm._library_tables(p_area text default null)
returns text[]
language sql immutable
as $$
  select case p_area
    when 'payers'  then array['payers', 'payer_plans', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_forms', 'payer_notes', 'payer_auth_rules']
    when 'denials' then array['denial_codes', 'denial_steps']
    when 'sops'    then array['sop_categories', 'sop_software', 'sop_tasks', 'sops', 'sop_versions', 'sop_media']
    when 'codes'   then array['ref_codes']
    else array['payers', 'payer_plans', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_forms', 'payer_notes', 'payer_auth_rules',
               'denial_codes', 'denial_steps', 'sop_categories', 'sop_software', 'sop_tasks', 'sops', 'sop_versions', 'sop_media', 'ref_codes']
  end;
$$;

-- Any valid sign-in (a company user's session, or the owner key)
create or replace function rcm._any_session()
returns boolean
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select rcm._owner_key_ok()
      or exists (select 1 from rcm.helix_user_sessions s where s.token = rcm._hdr('x-helix-session') and s.expires_at > now());
$$;
revoke all on function rcm._any_session() from public;
grant execute on function rcm._any_session() to anon, authenticated;

-- Who made a master change: the signed-in owner (owner key or "open company" session), else SYSTEM
create or replace function rcm._master_actor()
returns text
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select coalesce(
    (select o.username from rcm.helix_owner_sessions o where o.token = rcm._hdr('x-helix-owner') and o.expires_at > now()),
    (select s.as_owner from rcm.helix_user_sessions s where s.token = rcm._hdr('x-helix-session') and s.expires_at > now()),
    'SYSTEM');
$$;
revoke all on function rcm._master_actor() from public, anon, authenticated;

-- ── Change history ──────────────────────────────────────────────────────────
create table if not exists rcm.helix_master_changes (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  owner    text        not null,
  tbl      text        not null,            -- library table without the co_master__ prefix, e.g. 'payers'
  row_id   text,
  action   text        not null check (action in ('add', 'change', 'remove')),
  before   jsonb,
  after    jsonb,
  txid     bigint      not null default txid_current(),
  logged   boolean     not null default false
);
create index if not exists helix_master_changes_tbl on rcm.helix_master_changes (tbl, at desc);
create index if not exists helix_master_changes_tx on rcm.helix_master_changes (txid) where not logged;
alter table rcm.helix_master_changes enable row level security;
revoke all on rcm.helix_master_changes from anon, authenticated;

create or replace function rcm._master_change_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;   -- nothing really changed
  insert into rcm.helix_master_changes (owner, tbl, row_id, action, before, after)
  values (rcm._master_actor(), substr(tg_table_name, length('co_master__') + 1), coalesce(v_new, v_old)->>'id',
          case tg_op when 'INSERT' then 'add' when 'UPDATE' then 'change' else 'remove' end, v_old, v_new);
  return null;
end;
$$;
revoke all on function rcm._master_change_trg() from public, anon, authenticated;

-- One owner-log line per save / import (per statement), with the counts
create or replace function rcm._master_change_log_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_tbl text := substr(tg_table_name, length('co_master__') + 1);
  v     record;
begin
  for v in
    select owner, count(*) filter (where action = 'add') as added, count(*) filter (where action = 'change') as changed,
           count(*) filter (where action = 'remove') as removed
    from rcm.helix_master_changes where txid = txid_current() and tbl = v_tbl and not logged group by owner
  loop
    perform rcm._owner_log(v.owner, 'master_change', 'MASTER', 'Master ' || replace(v_tbl, '_', ' '),
                           jsonb_build_object('table', v_tbl, 'added', v.added, 'changed', v.changed, 'removed', v.removed));
  end loop;
  update rcm.helix_master_changes set logged = true where txid = txid_current() and tbl = v_tbl and not logged;
  return null;
end;
$$;
revoke all on function rcm._master_change_log_trg() from public, anon, authenticated;

-- ── Read rule for companies + history triggers on every master library table ─────
do $$
declare
  m text := (select prefix from rcm.companies where is_master);
  t text;
begin
  if m is null then raise exception 'Run migration 47 first (no master copy)'; end if;
  foreach t in array rcm._library_tables() loop
    if to_regclass(format('rcm.%I', m || t)) is null then continue; end if;
    if not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = m || t and policyname = 'helix_library_read') then
      execute format('create policy helix_library_read on rcm.%I for select to anon, authenticated using ((select rcm._any_session()))', m || t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = format('rcm.%I', m || t)::regclass and tgname = 'master_change') then
      execute format('create trigger master_change after insert or update or delete on rcm.%I for each row execute function rcm._master_change_trg()', m || t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = format('rcm.%I', m || t)::regclass and tgname = 'master_change_log') then
      execute format('create trigger master_change_log after insert or update or delete on rcm.%I for each statement execute function rcm._master_change_log_trg()', m || t);
    end if;
  end loop;
end;
$$;

-- Master files (payer forms, SOP screenshots / videos in co_master/) can be opened by any signed-in user
do $$
declare
  b text;
begin
  foreach b in array array['sop-media', 'payer-forms'] loop
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'helix_library_read_' || replace(b, '-', '_')) then
      execute format('create policy %I on storage.objects for select to anon, authenticated
                      using (bucket_id = %L and split_part(name, ''/'', 1) = ''co_master'' and rcm._any_session())',
                     'helix_library_read_' || replace(b, '-', '_'), b);
    end if;
  end loop;
end;
$$;

-- ── History for the Owner Console ───────────────────────────────────────────
create or replace function rcm.owner_master_history(p_by_user text, p_by_password text, p_area text, p_limit int default 200)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', c.at, 'owner', c.owner, 'tbl', c.tbl, 'action', c.action, 'row_id', c.row_id,
             'label', coalesce(r->>'name', r->>'title', case when r ? 'code' then coalesce(upper(r->>'code_type') || ' ', upper(r->>'code_set') || ' ', '') || (r->>'code') end,
                               r->>'electronic_payer_id', r->>'plan_name', r->>'department', r->>'limit_type', left(r->>'note', 50),
                               left(r->>'steps', 50), r->>'service', r->>'kind', '#' || c.row_id),
             'fields', case when c.action = 'change' then (
                         select jsonb_agg(k) from jsonb_object_keys(c.after) k
                         where k not in ('updated_at', 'updated_by') and c.after->k is distinct from c.before->k) end)
           order by c.at desc, c.id desc)
    from (select *, coalesce(after, before) as r from rcm.helix_master_changes
          where tbl = any(rcm._library_tables(p_area)) order by at desc, id desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) c
  ), '[]'::jsonb);
end;
$$;
revoke all on function rcm.owner_master_history(text, text, text, int) from public;
grant execute on function rcm.owner_master_history(text, text, text, int) to anon, authenticated;

notify pgrst, 'reload schema';
