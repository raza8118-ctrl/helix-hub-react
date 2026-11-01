-- ═══════════════════════════════════════════════════════════════════════════
-- Security stage 6, phase 1 — rules inside a company (PO approved 2026-11-01)
-- Run once in Supabase → SQL Editor. Additive (no tables/columns dropped, no data changed); safe to re-run.
-- No "Sync structure" needed.
--
--   • Stage 3 lets anyone signed in to a company change any of its rows. This adds who-may-change rules (reading is
--     unchanged) for the most important tables, using the person's CURRENT role and grants (users.access_grants),
--     mirroring src/lib/access.js (MANAGERS = admin, manager; MONITORS = admin, manager, supervisor):
--       daily_logs, hourly_logs ............ your own rows; supervisor and above for anyone's
--       processes, task_configs ............ admin / manager, or the Settings or Team grant
--       holidays ........................... supervisor and above
--       clients ............................ admin / manager, or "Edit Clients & Payers"
--       payers ............................. admin / manager, or "Edit Payer Directory" / "Edit Clients & Payers"
--       payer_contacts / ids / forms / plans / notes / limits / auth_rules ... "Edit Payer Directory"
--       denial_codes, denial_steps ......... "Edit Denial library"
--       sops + categories / software / tasks / versions / media / quizzes ... "Edit SOP Library"
--       appeal_templates, note_formats, ref_codes, client_portals ... their own grants
--       qa_scorecards / checkpoints / categories ... "Manage QA scorecards"; qa_mistakes ... "Edit error library"
--       learning_paths, learning_path_items ... "Manage learning paths"
--       rcm_store .......................... your own prefs_<ID>; else supervisor and above (Appeal Packet naming:
--                                            its grant; alloc_*: the Work Allocation grant)
--     The Helix Hub owner (owner key, or a company opened from the Owner Console) may always change.
--   • Per-company switch helix_rls_settings.role_rules: 3Gen and Test Co start OFF; companies added later start ON.
--     Kill switch:  update rcm.helix_rls_settings set role_rules = false where prefix = '<prefix>';
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  -- Existing companies start with the new rules switched off — only when the column is first added, so re-running
  -- this file never switches a company back off
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'rcm' and table_name = 'helix_rls_settings' and column_name = 'role_rules') then
    alter table rcm.helix_rls_settings add column role_rules boolean not null default true;
    update rcm.helix_rls_settings set role_rules = false;
  end if;
end $$;

-- Who is asking, for this company: { owner } or { emp_id, role, grants } (current values), or null
create or replace function rcm._me(p_prefix text)
returns jsonb
language plpgsql stable security definer
set search_path = rcm, pg_temp
as $$
declare
  s    rcm.helix_user_sessions;
  v_me jsonb;
begin
  if rcm._owner_key_ok() then return jsonb_build_object('owner', true); end if;
  s := rcm.current_session();
  if s.token is null or s.prefix is distinct from p_prefix then return null; end if;
  if s.as_owner is not null then return jsonb_build_object('owner', true, 'emp_id', s.emp_id); end if;
  execute format('select to_jsonb(u) from rcm.%I u where emp_id = $1 and active is not false', p_prefix || 'users')
     into v_me using s.emp_id;
  if v_me is null then return null; end if;
  return jsonb_build_object('emp_id', v_me->>'emp_id', 'role', v_me->>'role', 'grants', coalesce(v_me->'access_grants', '{}'::jsonb));
end;
$$;
revoke all on function rcm._me(text) from public;
grant execute on function rcm._me(text) to anon, authenticated;

create or replace function rcm._my_emp(p_prefix text)
returns text
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select s.emp_id from (select (rcm.current_session()).*) s where s.prefix = p_prefix;
$$;
revoke all on function rcm._my_emp(text) from public;
grant execute on function rcm._my_emp(text) to anon, authenticated;

-- May the person change data guarded by p_keys ('a|b' = any of them; 'MONITORS' = supervisor and above)?
-- Always true while the company's role_rules switch is off.
create or replace function rcm._may(p_prefix text, p_keys text)
returns boolean
language plpgsql stable security definer
set search_path = rcm, pg_temp
as $$
declare
  m   jsonb;
  k   text;
begin
  if not coalesce((select role_rules from rcm.helix_rls_settings where prefix = p_prefix), true) then return true; end if;
  m := rcm._me(p_prefix);
  if m is null then return false; end if;
  if (m->>'owner')::boolean then return true; end if;
  if m->>'role' in ('admin', 'manager') then return true; end if;   -- every phase-1 permission is a MANAGERS default
  foreach k in array string_to_array(p_keys, '|') loop
    if k = 'MONITORS' and m->>'role' = 'supervisor' then return true; end if;
    if coalesce((m->'grants'->>k)::boolean, false) then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function rcm._may(text, text) from public;
grant execute on function rcm._may(text, text) to anon, authenticated;

-- Which rule a table gets (by its home name); null = stage-3 rule only
create or replace function rcm._role_rule_for(p_base text)
returns text
language sql immutable
as $$
  select case
    when p_base in ('daily_logs', 'hourly_logs') then 'OWN'
    when p_base = 'rcm_store' then 'STORE'
    when p_base in ('processes', 'task_configs') then 'page_settings|page_team'
    when p_base = 'holidays' then 'MONITORS'
    when p_base = 'clients' then 'masters_edit'
    when p_base = 'payers' then 'payers_edit|masters_edit'
    when p_base in ('payer_contacts', 'payer_ids', 'payer_forms', 'payer_plans', 'payer_notes', 'payer_limits', 'payer_auth_rules') then 'payers_edit'
    when p_base in ('denial_codes', 'denial_steps') then 'denials_edit'
    when p_base in ('sops', 'sop_categories', 'sop_software', 'sop_tasks', 'sop_versions', 'sop_media', 'sop_quizzes') then 'sops_edit'
    when p_base = 'appeal_templates' then 'appeal_templates'
    when p_base = 'note_formats' then 'note_formats'
    when p_base = 'ref_codes' then 'ref_codes_edit'
    when p_base = 'client_portals' then 'portals_edit'
    when p_base in ('qa_scorecards', 'qa_checkpoints', 'qa_categories') then 'qa_manage'
    when p_base = 'qa_mistakes' then 'mistakes_edit'
    when p_base in ('learning_paths', 'learning_path_items') then 'training_manage'
  end;
$$;

-- Replace one table's stage-3 "anything" rule with read + change rules
create or replace function rcm._protect_roles(p_table text, p_prefix text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_rule text := rcm._role_rule_for(substr(p_table, length(p_prefix) + 1));
  v_in   text := format('(select rcm._allowed(%L))', p_prefix);
  v_may  text;
  v_pol  text;
begin
  if v_rule is null or to_regclass(format('rcm.%I', p_table)) is null then return; end if;
  v_may := case v_rule
    when 'OWN' then format('((select rcm._may(%L, %L)) or emp_id = (select rcm._my_emp(%L)))', p_prefix, 'MONITORS', p_prefix)
    when 'STORE' then format('((select rcm._may(%L, %L)) or key = ''prefs_'' || (select rcm._my_emp(%L))'
                             ' or (key = ''packet_naming'' and (select rcm._may(%L, %L)))'
                             ' or (key like ''alloc\_%%'' and (select rcm._may(%L, %L))))',
                             p_prefix, 'MONITORS', p_prefix, p_prefix, 'packet_settings', p_prefix, 'page_allocation')
    else format('(select rcm._may(%L, %L))', p_prefix, v_rule)
  end;
  execute format('drop policy if exists helix_session on rcm.%I', p_table);
  foreach v_pol in array array['helix_read', 'helix_insert', 'helix_update', 'helix_delete'] loop
    if not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = p_table and policyname = v_pol) then
      execute case v_pol
        when 'helix_read'   then format('create policy helix_read on rcm.%I for select to anon, authenticated using (%s)', p_table, v_in)
        when 'helix_insert' then format('create policy helix_insert on rcm.%I for insert to anon, authenticated with check (%s and %s)', p_table, v_in, v_may)
        when 'helix_update' then format('create policy helix_update on rcm.%I for update to anon, authenticated using (%s and %s) with check (%s and %s)', p_table, v_in, v_may, v_in, v_may)
        else                     format('create policy helix_delete on rcm.%I for delete to anon, authenticated using (%s and %s)', p_table, v_in, v_may)
      end;
    end if;
  end loop;
end;
$$;
revoke all on function rcm._protect_roles(text, text) from public, anon, authenticated;

-- Same as stage 3, plus the change rules above (so new companies and future tables get them too)
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
  elsif rcm._role_rule_for(v_base) is not null then
    perform rcm._protect_roles(p_table, p_prefix);
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

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
