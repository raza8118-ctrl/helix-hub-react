-- ═══════════════════════════════════════════════════════════════════════════
-- Demo data (PO request 2026-11-01)
-- Run once in Supabase → SQL Editor. Additive (functions only); safe to re-run. No "Sync structure" needed.
--
--   • Owner Console → Companies → Manage → "Demo data" calls these (owner key only):
--       owner_demo_load    fills an ADDED company with fake data and returns the demo users' one-time password
--       owner_demo_remove  deletes only the demo rows again
--       owner_demo_status  counts what is loaded
--   • Never the home company (3Gen) — the functions refuse it.
--   • Everything is fake and tagged: created_by = 'DEMO_DATA', user IDs DEMO-01…DEMO-09, processes in project 'DEMO',
--     claim numbers DEMO-1000xx. No patient data anywhere (worklist claims carry no patient fields).
--   • Remove touches only tagged rows; anything a person added by hand stays. If a person's own data points at a demo
--     payer / client, that payer / client is kept and the result says so.
-- ═══════════════════════════════════════════════════════════════════════════

-- Owner check + the company's table prefix (refuses the home company)
create or replace function rcm._demo_prefix(p_by_user text, p_by_password text, p_code text)
returns text
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  select prefix into v_prefix from rcm.companies where code = upper(trim(coalesce(p_code, '')));
  if v_prefix is null then
    raise exception 'Demo data can only go into an added company — never the home company';
  end if;
  return v_prefix;
end;
$$;
revoke all on function rcm._demo_prefix(text, text, text) from public, anon, authenticated;

create or replace function rcm._demo_counts(p text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  r jsonb := '{}';
  n int;
begin
  execute format('select count(*) from rcm.%I where emp_id like ''DEMO-%%''', p || 'users') into n;
  r := r || jsonb_build_object('users', n);
  execute format('select count(*) from rcm.%I where created_by = ''DEMO_DATA''', p || 'clients') into n;
  r := r || jsonb_build_object('clients', n);
  execute format('select count(*) from rcm.%I where created_by = ''DEMO_DATA''', p || 'payers') into n;
  r := r || jsonb_build_object('payers', n);
  execute format('select count(*) from rcm.%I where emp_id like ''DEMO-%%''', p || 'daily_logs') into n;
  r := r || jsonb_build_object('daily_reports', n);
  execute format('select count(*) from rcm.%I i join rcm.%I w on w.id = i.worklist_id where w.created_by = ''DEMO_DATA''',
                 p || 'worklist_items', p || 'worklists') into n;
  r := r || jsonb_build_object('denied_claims', n);
  execute format('select count(*) from rcm.%I where created_by = ''DEMO_DATA''', p || 'denial_steps') into n;
  r := r || jsonb_build_object('denial_entries', n);
  return r;
end;
$$;
revoke all on function rcm._demo_counts(text) from public, anon, authenticated;

create or replace function rcm.owner_demo_status(p_by_user text, p_by_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  return rcm._demo_counts(rcm._demo_prefix(p_by_user, p_by_password, p_code));
end;
$$;
revoke all on function rcm.owner_demo_status(text, text, text) from public;
grant execute on function rcm.owner_demo_status(text, text, text) to anon, authenticated;

-- ── Load ────────────────────────────────────────────────────────────────────
create or replace function rcm.owner_demo_load(p_by_user text, p_by_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  p        text := rcm._demo_prefix(p_by_user, p_by_password, p_code);
  v_pw     text := 'Demo-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_c      bigint[];
  v_p      bigint[];
  v_wl     bigint;
  v_counts jsonb;
begin
  if (rcm._demo_counts(p)->>'users')::int > 0 then
    raise exception 'Demo data is already loaded in this company — remove it first to load it again';
  end if;
  perform setseed(0.42);   -- the same believable numbers every time

  -- Processes (project DEMO) + daily task targets
  execute format('insert into rcm.%I (name, active, project) values
                    (''DEMO AR'', true, ''DEMO''), (''DEMO DENIALS'', true, ''DEMO''), (''DEMO AUTH'', true, ''DEMO'')', p || 'processes');
  execute format('insert into rcm.%I (process, name, target) values
                    (''DEMO AR'', ''Follow-up calls'', 30), (''DEMO AR'', ''Status checks'', 20),
                    (''DEMO DENIALS'', ''Denials worked'', 25), (''DEMO DENIALS'', ''Appeals sent'', 10),
                    (''DEMO AUTH'', ''Auths submitted'', 30), (''DEMO AUTH'', ''Auth follow-ups'', 15)', p || 'task_configs');

  -- Clients + payers (fictional)
  execute format('with ins as (insert into rcm.%I (name, code, project, notes, active, created_by, updated_by) values
                    (''Sunrise Home Health (Demo)'', ''DEMO-SUN'', ''DEMO'', ''Demo client — not a real agency'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Maple Hospice (Demo)'',       ''DEMO-MAP'', ''DEMO'', ''Demo client — not a real agency'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Riverbend Care (Demo)'',      ''DEMO-RIV'', ''DEMO'', ''Demo client — not a real agency'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Harbor Therapy (Demo)'',      ''DEMO-HAR'', ''DEMO'', ''Demo client — not a real agency'', true, ''DEMO_DATA'', ''DEMO_DATA'')
                  returning id) select array_agg(id order by id) from ins', p || 'clients') into v_c;
  execute format('with ins as (insert into rcm.%I (name, aliases, payer_type, notes, active, created_by, updated_by) values
                    (''Northwind Health Plan (Demo)'', array[''Northwind''], ''Commercial'', ''Demo payer — not real'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Lakeside Medicaid (Demo)'',     array[''Lakeside''],  ''Medicaid'',   ''Demo payer — not real'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Summit Advantage (Demo)'',      array[''Summit''],    ''Medicare Advantage'', ''Demo payer — not real'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Bluebird Insurance (Demo)'',    array[''Bluebird''],  ''Commercial'', ''Demo payer — not real'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Prairie Care Plan (Demo)'',     array[''Prairie''],   ''Medicaid'',   ''Demo payer — not real'', true, ''DEMO_DATA'', ''DEMO_DATA''),
                    (''Coastal Senior Plan (Demo)'',   array[''Coastal''],   ''Medicare Advantage'', ''Demo payer — not real'', true, ''DEMO_DATA'', ''DEMO_DATA'')
                  returning id) select array_agg(id order by id) from ins', p || 'payers') into v_p;
  execute format('insert into rcm.%I (payer_id, clearinghouse, electronic_payer_id, transaction_type, enrollment_required, notes, active, created_by, updated_by)
                  select v_id, ''Demo Clearinghouse'', ''DEMO'' || lpad(n::text, 3, ''0''), ''837P'', n %% 2 = 0, ''Demo payer ID — not real'', true, ''DEMO_DATA'', ''DEMO_DATA''
                    from unnest($1) with ordinality u(v_id, n)', p || 'payer_ids') using v_p;

  -- Users: 1 supervisor + 8 employees (fictional names); the trigger stores the one-time password in the locked table
  execute format('insert into rcm.%I (emp_id, name, password, role, access, processes, supervisor_ids, supervised_processes, team, target, active, is_qa, can_view_audit, access_grants)
                  select e.id, e.name, $1, e.role, e.access, e.procs, e.sups, e.sup_procs, e.team, null, true, false, false, ''{}''::jsonb
                    from (values
                      (''DEMO-09'', ''Jordan Demo'', ''supervisor'', ''DEMO AR'', array[''DEMO AR'',''DEMO DENIALS'',''DEMO AUTH''], array[]::text[], array[''DEMO AR'',''DEMO DENIALS'',''DEMO AUTH''], ''AR''),
                      (''DEMO-01'', ''Alex Demo'',  ''employee'', ''DEMO AR'',      array[''DEMO AR''],      array[''DEMO-09''], array[]::text[], ''AR''),
                      (''DEMO-02'', ''Priya Demo'', ''employee'', ''DEMO AR'',      array[''DEMO AR''],      array[''DEMO-09''], array[]::text[], ''AR''),
                      (''DEMO-03'', ''Sam Demo'',   ''employee'', ''DEMO AR'',      array[''DEMO AR''],      array[''DEMO-09''], array[]::text[], ''AR''),
                      (''DEMO-04'', ''Meera Demo'', ''employee'', ''DEMO AR'',      array[''DEMO AR''],      array[''DEMO-09''], array[]::text[], ''AR''),
                      (''DEMO-05'', ''Ravi Demo'',  ''employee'', ''DEMO DENIALS'', array[''DEMO DENIALS''], array[''DEMO-09''], array[]::text[], ''AR''),
                      (''DEMO-06'', ''Nina Demo'',  ''employee'', ''DEMO DENIALS'', array[''DEMO DENIALS''], array[''DEMO-09''], array[]::text[], ''AR''),
                      (''DEMO-07'', ''Omar Demo'',  ''employee'', ''DEMO AUTH'',    array[''DEMO AUTH''],    array[''DEMO-09''], array[]::text[], ''Auth''),
                      (''DEMO-08'', ''Lena Demo'',  ''employee'', ''DEMO AUTH'',    array[''DEMO AUTH''],    array[''DEMO-09''], array[]::text[], ''Auth'')
                    ) e(id, name, role, access, procs, sups, sup_procs, team)', p || 'users') using v_pw;

  -- Daily reports: the last 30 working days for each employee (70–115% of target, ~3% leave days)
  execute format($q$
    insert into rcm.%I (emp_id, emp_name, date, process, total, target, adj_target, base_target, shift_hours,
                        attendance_status, quality, tasks, submitted, submitted_at)
    select e.id, e.name, to_char(d.day, 'YYYY-MM-DD'), e.proc,
           case when x.off then 0 else round(e.t1 * x.f) + round(e.t2 * x.f) end,
           e.t1 + e.t2, e.t1 + e.t2, e.t1 + e.t2, 9,
           case when x.off then 'absent' else 'present' end,
           case when x.off then null else least(100, round((96 + (x.q - 0.6) * 10)::numeric, 1)) end,
           case when x.off then '{}'::jsonb
                else jsonb_build_object(e.n1, round(e.t1 * x.f), e.n2, round(e.t2 * x.f)) end,
           true, (d.day + time '19:00') at time zone 'Asia/Kolkata'
      from (values
        ('DEMO-01', 'Alex Demo',  'DEMO AR',      'Follow-up calls', 30, 'Status checks',   20, 1.02),
        ('DEMO-02', 'Priya Demo', 'DEMO AR',      'Follow-up calls', 30, 'Status checks',   20, 0.95),
        ('DEMO-03', 'Sam Demo',   'DEMO AR',      'Follow-up calls', 30, 'Status checks',   20, 0.86),
        ('DEMO-04', 'Meera Demo', 'DEMO AR',      'Follow-up calls', 30, 'Status checks',   20, 1.06),
        ('DEMO-05', 'Ravi Demo',  'DEMO DENIALS', 'Denials worked',  25, 'Appeals sent',    10, 0.98),
        ('DEMO-06', 'Nina Demo',  'DEMO DENIALS', 'Denials worked',  25, 'Appeals sent',    10, 0.90),
        ('DEMO-07', 'Omar Demo',  'DEMO AUTH',    'Auths submitted', 30, 'Auth follow-ups', 15, 1.00),
        ('DEMO-08', 'Lena Demo',  'DEMO AUTH',    'Auths submitted', 30, 'Auth follow-ups', 15, 0.93)
      ) e(id, name, proc, n1, t1, n2, t2, bias)
      cross join (select g::date as day from generate_series($1 - 44, $1 - 1, interval '1 day') g
                   where extract(isodow from g) < 6 order by g desc limit 30) d
      cross join lateral (select greatest(0.70, least(1.15, e.bias + (random() - 0.5) * 0.25)) as f,
                                 random() < 0.03 + 0 * e.t1 as off, random() + 0 * e.t1 as q) x
  $q$, p || 'daily_logs') using v_today;

  -- Today: 6 of the 8 have already submitted (the other 2 show as pending on Today)
  execute format($q$
    insert into rcm.%I (emp_id, emp_name, date, process, total, target, adj_target, base_target, shift_hours,
                        attendance_status, quality, tasks, submitted, submitted_at)
    select e.id, e.name, to_char($1, 'YYYY-MM-DD'), e.proc, round(e.t1 * x.f) + round(e.t2 * x.f),
           e.t1 + e.t2, e.t1 + e.t2, e.t1 + e.t2, 9, 'present', round((95 + x.q * 4)::numeric, 1),
           jsonb_build_object(e.n1, round(e.t1 * x.f), e.n2, round(e.t2 * x.f)), true, now()
      from (values
        ('DEMO-01', 'Alex Demo',  'DEMO AR',      'Follow-up calls', 30, 'Status checks', 20, 1.04),
        ('DEMO-02', 'Priya Demo', 'DEMO AR',      'Follow-up calls', 30, 'Status checks', 20, 0.97),
        ('DEMO-03', 'Sam Demo',   'DEMO AR',      'Follow-up calls', 30, 'Status checks', 20, 0.82),
        ('DEMO-04', 'Meera Demo', 'DEMO AR',      'Follow-up calls', 30, 'Status checks', 20, 1.08),
        ('DEMO-05', 'Ravi Demo',  'DEMO DENIALS', 'Denials worked',  25, 'Appeals sent',  10, 1.00),
        ('DEMO-06', 'Nina Demo',  'DEMO DENIALS', 'Denials worked',  25, 'Appeals sent',  10, 0.91)
      ) e(id, name, proc, n1, t1, n2, t2, bias)
      cross join lateral (select e.bias + (random() - 0.5) * 0.06 as f, random() + 0 * e.t1 as q) x
  $q$, p || 'daily_logs') using v_today;

  -- Today's hourly counts (first hours of the shift)
  execute format($q$
    insert into rcm.%I (emp_id, date, h0, h1, h2, h3, h4)
    select e.id, to_char($1, 'YYYY-MM-DD'),
           round(e.t / 9.0 * (0.8 + random() * 0.4)), round(e.t / 9.0 * (0.8 + random() * 0.4)),
           round(e.t / 9.0 * (0.8 + random() * 0.4)), round(e.t / 9.0 * (0.8 + random() * 0.4)),
           round(e.t / 9.0 * (0.6 + random() * 0.4))
      from (values ('DEMO-01', 50), ('DEMO-02', 50), ('DEMO-03', 50), ('DEMO-04', 50),
                   ('DEMO-05', 35), ('DEMO-06', 35), ('DEMO-07', 45), ('DEMO-08', 45)) e(id, t)
  $q$, p || 'hourly_logs') using v_today;

  -- Denial library: plain-English reasons + next steps (public CARC codes; demo wording)
  execute format($q$
    insert into rcm.%I (code_type, code, plain_reason, category, notes, source, active, created_by, updated_by)
    values ('carc', '16',  'Claim is missing information the payer needs.', 'Missing info', 'Demo entry', 'demo', true, 'DEMO_DATA', 'DEMO_DATA'),
           ('carc', '50',  'Payer says the service was not medically necessary.', 'Medical necessity', 'Demo entry', 'demo', true, 'DEMO_DATA', 'DEMO_DATA'),
           ('carc', '97',  'Service is bundled into another paid service.', 'Bundling', 'Demo entry', 'demo', true, 'DEMO_DATA', 'DEMO_DATA'),
           ('carc', '29',  'Claim was filed after the time limit.', 'Timely filing', 'Demo entry', 'demo', true, 'DEMO_DATA', 'DEMO_DATA'),
           ('carc', '18',  'Duplicate of a claim already received.', 'Duplicate', 'Demo entry', 'demo', true, 'DEMO_DATA', 'DEMO_DATA'),
           ('carc', '197', 'Authorization was required but not on file.', 'Authorization', 'Demo entry', 'demo', true, 'DEMO_DATA', 'DEMO_DATA')
    on conflict do nothing
  $q$, p || 'denial_codes');
  execute format($q$
    insert into rcm.%I (code_id, scope, steps, notes, active, created_by, updated_by)
    select c.id, 'common', s.steps, 'Demo steps', true, 'DEMO_DATA', 'DEMO_DATA'
      from rcm.%I c
      join (values
        ('16',  E'1. Check the remark code for what is missing.\n2. Add the missing detail and send a corrected claim.'),
        ('50',  E'1. Pull the visit notes and plan of care.\n2. Send an appeal with the supporting documents.'),
        ('97',  E'1. Check which service it was bundled into.\n2. Add a modifier if it was truly separate, then rebill.'),
        ('29',  E'1. Look for proof of the original filing date.\n2. Appeal with that proof, or write off per the client rules.'),
        ('18',  E'1. Find the original claim and its status.\n2. Close this one if it is a true duplicate.'),
        ('197', E'1. Check the auth tracker for an approval.\n2. Request a retro authorization or appeal with the approval.')
      ) s(code, steps) on upper(c.code) = s.code and c.code_type = 'carc'
     where not exists (select 1 from rcm.%I x where x.code_id = c.id and x.scope = 'common')
  $q$, p || 'denial_steps', p || 'denial_codes', p || 'denial_steps');

  -- Smart Worklist: 40 fake denied claims (no patient fields exist on worklist claims)
  execute format($q$
    insert into rcm.%I (name, client_id, team, status, row_count, dropped_columns, uploaded_by, uploaded_at, created_by, updated_by)
    values ('Demo denials worklist', $1, 'AR', 'open', 40, 0, 'DEMO-09', now(), 'DEMO_DATA', 'DEMO_DATA') returning id
  $q$, p || 'worklists') using v_c[1] into v_wl;
  execute format($q$
    insert into rcm.%I (worklist_id, claim_number, payer_id, payer_name, client_id, dos_from, dos_to, billed, balance,
                        aging_days, denial_date, deadline, deadline_type, denial_code, assigned_to, status,
                        follow_up, worked_at, worked_by, cleared, active, updated_by)
    select $1, 'DEMO-' || (100000 + i), $2[1 + i %% 6],
           (array['Northwind Health Plan (Demo)','Lakeside Medicaid (Demo)','Summit Advantage (Demo)',
                  'Bluebird Insurance (Demo)','Prairie Care Plan (Demo)','Coastal Senior Plan (Demo)'])[1 + i %% 6],
           $3[1 + i %% 4], dos, dos, billed, round((billed * (0.4 + random() * 0.6))::numeric, 2),
           $4 - dos, dos + 25, dos + 25 + (array[30, 60, 90, 120])[1 + i %% 4], 'Appeal',
           (array['CO-16','CO-50','CO-97','CO-29','CO-18','CO-197'])[1 + i %% 6],
           'DEMO-0' || (1 + i %% 6), st,
           case when st = 'followup' then $4 + (i %% 7) end,
           case when st <> 'new' then now() - (i %% 9) * interval '1 day' end,
           case when st <> 'new' then 'DEMO-0' || (1 + i %% 6) end,
           false, true, 'DEMO_DATA'
      from (select i, $4 - (20 + i * 4) as dos, round((150 + random() * 4850)::numeric, 2) as billed,
                   (array['new','new','new','followup','appealed','rebilled','paid','new','followup','denied_final'])[1 + i %% 10] as st
              from generate_series(1, 40) i) g
  $q$, p || 'worklist_items') using v_wl, v_p, v_c, v_today;

  v_counts := rcm._demo_counts(p);
  perform rcm._owner_log(p_by_user, 'demo_data_load', upper(p_code), null, v_counts);
  execute format('insert into rcm.%I (actor_emp_id, actor_name, actor_role, action, entity_type, entity_id, details)
                  values ($1, ''Helix Hub owner'', ''owner'', ''demo_data_load'', ''demo'', null, $2)', p || 'audit_log')
    using upper(trim(p_by_user)), v_counts;
  return jsonb_build_object('password', v_pw, 'counts', v_counts);
end;
$$;
revoke all on function rcm.owner_demo_load(text, text, text) from public;
grant execute on function rcm.owner_demo_load(text, text, text) to anon, authenticated;

-- ── Remove (tagged rows only) ───────────────────────────────────────────────
create or replace function rcm.owner_demo_remove(p_by_user text, p_by_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  p       text := rcm._demo_prefix(p_by_user, p_by_password, p_code);
  v_kept  text[] := '{}';
  v_was   jsonb := rcm._demo_counts(p);
begin
  execute format('delete from rcm.%I where emp_id like ''DEMO-%%''', p || 'daily_logs');
  execute format('delete from rcm.%I where emp_id like ''DEMO-%%''', p || 'hourly_logs');
  execute format('delete from rcm.%I where worklist_id in (select id from rcm.%I where created_by = ''DEMO_DATA'')', p || 'worklist_items', p || 'worklists');
  execute format('delete from rcm.%I where created_by = ''DEMO_DATA''', p || 'worklists');
  execute format('delete from rcm.%I where created_by = ''DEMO_DATA''', p || 'denial_steps');
  begin
    execute format('delete from rcm.%I c where c.created_by = ''DEMO_DATA'' and not exists (select 1 from rcm.%I s where s.code_id = c.id)',
                   p || 'denial_codes', p || 'denial_steps');
  exception when foreign_key_violation then v_kept := v_kept || 'some demo denial codes (used by your own data)'::text; end;
  execute format('delete from rcm.%I where created_by = ''DEMO_DATA''', p || 'payer_ids');
  begin
    execute format('delete from rcm.%I where created_by = ''DEMO_DATA''', p || 'payers');
  exception when foreign_key_violation then v_kept := v_kept || 'demo payers (your own data uses them)'::text; end;
  begin
    execute format('delete from rcm.%I where created_by = ''DEMO_DATA''', p || 'clients');
  exception when foreign_key_violation then v_kept := v_kept || 'demo clients (your own data uses them)'::text; end;
  execute format('delete from rcm.%I where process in (select name from rcm.%I where project = ''DEMO'')', p || 'task_configs', p || 'processes');
  execute format('delete from rcm.%I where project = ''DEMO''', p || 'processes');
  execute format('delete from rcm.%I where key like ''prefs\_DEMO-%%''', p || 'rcm_store');
  execute format('delete from rcm.%I where emp_id like ''DEMO-%%''', p || 'users');
  delete from rcm.helix_user_passwords where prefix = p and emp_id like 'DEMO-%';
  delete from rcm.helix_user_sessions  where prefix = p and emp_id like 'DEMO-%';

  perform rcm._owner_log(p_by_user, 'demo_data_remove', upper(p_code), null, v_was);
  execute format('insert into rcm.%I (actor_emp_id, actor_name, actor_role, action, entity_type, entity_id, details)
                  values ($1, ''Helix Hub owner'', ''owner'', ''demo_data_remove'', ''demo'', null, $2)', p || 'audit_log')
    using upper(trim(p_by_user)), v_was;
  return jsonb_build_object('removed', v_was, 'left', rcm._demo_counts(p), 'kept', to_jsonb(v_kept));
end;
$$;
revoke all on function rcm.owner_demo_remove(text, text, text) from public;
grant execute on function rcm.owner_demo_remove(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
