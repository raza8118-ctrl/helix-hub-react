-- ═══════════════════════════════════════════════════════════════════════════
-- Master copy → files (PO request 2026-11-09), Stage 3. Migration 49.
-- Run once in Supabase → SQL Editor. Additive only (replaces three of our own functions, adds one); safe to re-run.
--
--   • A push now also covers payer forms (payer_forms, section "payers") and SOP screenshots / videos (sop_media and the
--     pictures / videos inside SOP steps + the walk-through video, section "sops").
--   • File paths are moved from the master's folder (co_master/…) to the company's folder (co_<code>/…, home: no folder).
--     The files themselves are copied by the app right after the push (storage API, owner key); owner_master_files lists
--     every pushed file the company is still missing, so a failed copy can simply be retried. Files are never deleted.
--   • The row fingerprint is now taken per row (needed for payer form families, which point at another form row).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function rcm._master_push_spec()
returns table (ord int, section text, tbl text, fks jsonb, filter text, natkey text, label text)
language sql immutable
as $$
  values
    (10,  'payers',  'payers',           '{}'::jsonb, 'true',
          'lower(t.name) = lower(s.name)', 's.name'),
    (20,  'payers',  'payer_plans',      '{"payer_id": "payers"}'::jsonb, 'true',
          't.payer_id = {payer_id} and lower(t.plan_name) = lower(s.plan_name)', '{PAYER} || '' · '' || s.plan_name'),
    (30,  'payers',  'payer_ids',        '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
          't.payer_id = {payer_id} and t.electronic_payer_id = s.electronic_payer_id and coalesce(t.clearinghouse, '''') = coalesce(s.clearinghouse, '''') and coalesce(t.transaction_type, '''') = coalesce(s.transaction_type, '''')',
          '{PAYER} || '' · '' || s.electronic_payer_id'),
    (40,  'payers',  'payer_contacts',   '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
          't.payer_id = {payer_id} and t.department = s.department and coalesce(t.phone, '''') = coalesce(s.phone, '''')',
          '{PAYER} || '' · '' || s.department'),
    (50,  'payers',  'payer_limits',     '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 's.client_id is null',
          't.payer_id = {payer_id} and t.limit_type = s.limit_type and coalesce(t.level, 0) = coalesce(s.level, 0) and t.client_id is null',
          '{PAYER} || '' · '' || s.limit_type'),
    (60,  'payers',  'payer_notes',      '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
          't.payer_id = {payer_id} and t.note = s.note', '{PAYER} || '' · '' || left(s.note, 40)'),
    (70,  'payers',  'payer_auth_rules', '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
          't.payer_id = {payer_id} and lower(coalesce(t.service, '''')) = lower(coalesce(s.service, ''''))',
          '{PAYER} || '' · '' || coalesce(s.service, ''auth rule'')'),
    (80,  'payers',  'payer_forms',      '{"payer_id": "payers", "plan_id": "payer_plans", "family_id": "?payer_forms"}'::jsonb, 'true',
          't.payer_id = {payer_id} and t.form_type = s.form_type and lower(t.title) = lower(s.title) and t.version_date is not distinct from s.version_date',
          '{PAYER} || '' · '' || s.title'),
    (90,  'sops',    'sop_categories',   '{}'::jsonb, 'true',
          'lower(t.name) = lower(s.name)', 's.name'),
    (100, 'sops',    'sop_software',     '{"category_id": "sop_categories"}'::jsonb, 'true',
          't.category_id = {category_id} and lower(t.name) = lower(s.name)', 's.name'),
    (110, 'sops',    'sop_tasks',        '{"software_id": "sop_software"}'::jsonb, 'true',
          't.software_id = {software_id} and lower(t.name) = lower(s.name)', 's.name'),
    (120, 'sops',    'sops',             '{"task_id": "sop_tasks"}'::jsonb, 's.client_id is null',
          't.task_id = {task_id} and lower(t.title) = lower(s.title) and t.client_id is null', 's.title'),
    (130, 'sops',    'sop_media',        '{"sop_id": "sops"}'::jsonb, 'true',
          't.sop_id = {sop_id} and t.path = {PATH}',
          '(select so.title from rcm.{M}sops so where so.id = s.sop_id) || '' · '' || s.kind'),
    (140, 'denials', 'denial_codes',     '{}'::jsonb, 'true',
          't.code_type = s.code_type and upper(t.code) = upper(s.code)', 'upper(s.code_type) || '' '' || s.code'),
    (150, 'denials', 'denial_steps',     '{"code_id": "denial_codes", "payer_id": "payers", "sop_id": "?sops"}'::jsonb, 's.client_id is null and s.scope <> ''client''',
          't.code_id = {code_id} and t.scope = s.scope and t.client_id is null and coalesce(t.payer_id, 0) = coalesce({payer_id}, 0)',
          '(select upper(c.code_type) || '' '' || c.code from rcm.{M}denial_codes c where c.id = s.code_id) || '' · '' || s.scope || '' steps'''),
    (160, 'codes',   'ref_codes',        '{}'::jsonb, 'true',
          't.code_set = s.code_set and t.code = s.code', 's.code_set || '' '' || s.code'),
    (170, 'targets', 'task_configs',     '{}'::jsonb, 'true',
          't.process = s.process and t.name = s.name', 's.process || '' · '' || s.name');
$$;

-- Storage folder of a table prefix: 'co_testco__' → 'co_testco/', home ('') → ''
create or replace function rcm._master_folder(p_prefix text)
returns text
language sql immutable
as $$
  select case when coalesce(p_prefix, '') = '' then '' else rtrim(p_prefix, '_') || '/' end;
$$;

-- ── The push itself, for one company (now with files and a per-row fingerprint) ─────────────
create or replace function rcm._master_push_company(p_master text, p_target text, p_sections text[], p_now timestamptz)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  sp       record;
  c        record;
  v_t      text;
  v_m      text;
  v_mf     text := rcm._master_folder(p_master);
  v_tf     text := rcm._master_folder(p_target);
  v_has_id boolean;
  v_cols   text;
  v_map    text;
  v_tcols  text;
  v_miss   text;
  v_nat    text;
  v_label  text;
  v_key    text;
  v_link   text;
  v_tid_e  text;
  v_tid_m  text;
  v_extra_ins_c text;
  v_extra_ins_v text;
  v_extra_upd   text;
  v_fk     text;
  v_par    text;
  v_expr   text;
  r        record;
  v_h      text;
  v_missing boolean;
  v_tid    text;
  v_cur    text;
  v_last   text;
  v_own    boolean;
  v_kind   text;
  v_lbl    text;
  v_res    jsonb := '{}'::jsonb;
  v_sid    bigint;
  v_status text;
begin
  for sp in select * from rcm._master_push_spec() where section = any(p_sections) order by ord loop
    v_t := p_target || sp.tbl;
    v_m := p_master || sp.tbl;
    if to_regclass(format('rcm.%I', v_t)) is null or to_regclass(format('rcm.%I', v_m)) is null then continue; end if;
    v_has_id := exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_m and column_name = 'id');

    v_cols := null; v_map := null; v_tcols := null; v_miss := null;
    for c in
      select col.column_name as name from information_schema.columns col
      where col.table_schema = 'rcm' and col.table_name = v_t
        and col.column_name not in ('id', 'master_id', 'master_pushed_at', 'master_hash', 'created_at', 'created_by',
                                    'updated_at', 'updated_by', 'owner', 'copied_from', 'uploaded_at')
        and exists (select 1 from information_schema.columns x where x.table_schema = 'rcm' and x.table_name = v_m and x.column_name = col.column_name)
      order by col.ordinal_position
    loop
      if sp.fks ? c.name then
        v_fk := sp.fks->>c.name;
        v_par := ltrim(v_fk, '?');
        v_expr := rcm._master_map_expr(v_par, format('s.%I', c.name), p_master, p_target);
        if left(v_fk, 1) <> '?' then
          v_miss := concat_ws(' or ', v_miss, format('(s.%I is not null and %s is null)', c.name, v_expr));
        end if;
      elsif (sp.tbl = 'payer_forms' and c.name = 'file_path') or (sp.tbl = 'sop_media' and c.name = 'path') then
        -- the file moves from the master's folder to the company's folder
        v_expr := format('case when left(s.%1$I, %2$s) = %3$L then %4$L || substr(s.%1$I, %5$s) else s.%1$I end',
                         c.name, length(v_mf), v_mf, v_tf, length(v_mf) + 1);
      elsif sp.tbl = 'sops' and c.name in ('steps', 'walkthrough_video') then
        -- pictures / videos inside SOP steps and the walk-through video point at the company's folder
        v_expr := format('replace(s.%I::text, %L, %L)::jsonb', c.name, '"' || v_mf, '"' || v_tf);
      else
        v_expr := format('s.%I', c.name);
      end if;
      v_cols  := concat_ws(', ', v_cols, quote_ident(c.name));
      v_map   := concat_ws(', ', v_map, v_expr);
      v_tcols := concat_ws(', ', v_tcols, format('t.%I', c.name));
    end loop;
    v_miss := coalesce(v_miss, 'false');

    v_nat := sp.natkey;
    for v_fk in select jsonb_object_keys(sp.fks) loop
      v_nat := replace(v_nat, '{' || v_fk || '}', rcm._master_map_expr(ltrim(sp.fks->>v_fk, '?'), format('s.%I', v_fk), p_master, p_target));
    end loop;
    v_nat := replace(v_nat, '{PATH}', format('case when left(s.path, %s) = %L then %L || substr(s.path, %s) else s.path end',
                                              length(v_mf), v_mf, v_tf, length(v_mf) + 1));
    v_label := replace(replace(sp.label, '{PAYER}', format('(select pp.name from rcm.%I pp where pp.id = s.payer_id)', p_master || 'payers')), '{M}', p_master);

    if v_has_id then
      v_key  := 's.id::text';
      v_link := 't.master_id = s.id';
      v_tid_e := 't.id::text';
      v_tid_m := 't.id = $4::bigint';
    else   -- task_configs: no id, matched by process + task name
      v_key  := 's.process || ''|'' || s.name';
      v_link := 't.process = s.process and t.name = s.name and t.master_hash is not null';
      v_tid_e := 't.ctid::text';
      v_tid_m := 't.ctid = $4::tid';
    end if;
    v_extra_ins_c := ''; v_extra_ins_v := ''; v_extra_upd := '';
    if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_t and column_name = 'created_by') then
      v_extra_ins_c := v_extra_ins_c || ', created_by'; v_extra_ins_v := v_extra_ins_v || ', ''HELIX_MASTER''';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_t and column_name = 'updated_at') then
      v_extra_upd := v_extra_upd || ', updated_at = $3';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_t and column_name = 'updated_by') then
      v_extra_upd := v_extra_upd || ', updated_by = ''HELIX_MASTER''';
    end if;

    for r in execute format('select %s as k, %s as label from rcm.%I s where %s order by s.%s',
                            v_key, v_label, v_m, sp.filter, case when v_has_id then 'id' else 'process, s.name' end)
    loop
      v_lbl := r.label;
      -- fingerprint + missing parent, taken now (rows pushed earlier in this table may be parents, e.g. form families)
      execute format('select md5(jsonb_build_array(%s)::text), (%s) from rcm.%I s where %s = $1', v_map, v_miss, v_m, v_key)
        into v_h, v_missing using r.k;
      v_tid := null; v_cur := null; v_last := null;
      execute format('select %s, md5(jsonb_build_array(%s)::text), t.master_hash from rcm.%I t, rcm.%I s where %s and %s = $1 limit 1',
                     v_tid_e, v_tcols, v_t, v_m, v_link, v_key)
        into v_tid, v_cur, v_last using r.k;

      if v_tid is not null then
        if v_last is not null and v_cur is distinct from v_last then
          v_kind := 'kept_changed';
        elsif v_cur = v_h then
          v_kind := 'unchanged';
        elsif v_missing then
          v_kind := 'skipped_parent';
        else
          begin
            execute format('update rcm.%I t set (%s) = (select %s from rcm.%I s where %s = $1), master_hash = $2, master_pushed_at = $3%s where %s',
                           v_t, v_cols, v_map, v_m, v_key, v_extra_upd, v_tid_m)
              using r.k, v_h, p_now, v_tid;
            v_kind := 'updated';
          exception when others then
            v_kind := 'conflict'; v_lbl := coalesce(v_lbl, '') || ' — ' || sqlerrm;
          end;
        end if;
      else
        execute format('select exists (select 1 from rcm.%I t, rcm.%I s where %s = $1 and t.master_hash is null and (%s))', v_t, v_m, v_key, v_nat)
          into v_own using r.k;
        if v_own then
          v_kind := 'kept_own';
        elsif v_missing then
          v_kind := 'skipped_parent';
        else
          begin
            if v_has_id then
              execute format('insert into rcm.%I (%s, master_id, master_hash, master_pushed_at%s) select %s, s.id, $2, $3%s from rcm.%I s where %s = $1',
                             v_t, v_cols, v_extra_ins_c, v_map, v_extra_ins_v, v_m, v_key)
                using r.k, v_h, p_now;
            else
              execute format('insert into rcm.%I (%s, master_hash, master_pushed_at) select %s, $2, $3 from rcm.%I s where %s = $1',
                             v_t, v_cols, v_map, v_m, v_key)
                using r.k, v_h, p_now;
            end if;
            v_kind := 'new';
          exception when others then
            v_kind := 'conflict'; v_lbl := coalesce(v_lbl, '') || ' — ' || sqlerrm;
          end;
        end if;
      end if;

      -- A new or updated SOP that is published in the master becomes a new version in the company
      if sp.tbl = 'sops' and v_kind in ('new', 'updated')
         and to_regclass(format('rcm.%I', p_target || 'sop_versions')) is not null then
        execute format('select t.id, t.status from rcm.%I t where t.master_id = $1::bigint', v_t) into v_sid, v_status using r.k;
        if v_status = 'published' then
          execute format('insert into rcm.%1$I (sop_id, version_no, snapshot, change_note, effective_date, requires_ack, published_by)
                          select t.id, coalesce((select max(v.version_no) from rcm.%1$I v where v.sop_id = t.id), 0) + 1,
                                 jsonb_build_object(''title'', t.title, ''summary'', t.summary, ''purpose'', t.purpose,
                                   ''audience_teams'', t.audience_teams, ''audience_notes'', t.audience_notes, ''prerequisites'', t.prerequisites,
                                   ''steps'', t.steps, ''expected_result'', t.expected_result, ''troubleshooting'', t.troubleshooting,
                                   ''walkthrough_video'', t.walkthrough_video),
                                 ''Updated from the Helix Hub master copy'', current_date, true, ''HELIX_MASTER''
                          from rcm.%2$I t where t.id = $1', p_target || 'sop_versions', v_t) using v_sid;
        end if;
      end if;

      v_res := rcm._mp_note(v_res, sp.section, sp.tbl, v_kind, v_lbl);
    end loop;
  end loop;
  return v_res;
end;
$$;
revoke all on function rcm._master_push_company(text, text, text[], timestamptz) from public, anon, authenticated;

-- ── Files a company is still missing: pushed form / media rows whose file isn't in its folder yet ───────
-- → [{ bucket, from, to }] — the app copies each one (storage API, owner key) and can call this again to retry.
create or replace function rcm.owner_master_files(p_by_user text, p_by_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m     rcm.companies;
  v_tgt text;
  v_out jsonb := '[]'::jsonb;
  v_add jsonb;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  select * into m from rcm.companies where is_master;
  if not found then return v_out; end if;
  v_tgt := rcm._master_target(p_code);
  if v_tgt is null then return v_out; end if;

  if to_regclass(format('rcm.%I', v_tgt || 'payer_forms')) is not null then
    execute format('select coalesce(jsonb_agg(jsonb_build_object(''bucket'', ''payer-forms'', ''from'', s.file_path, ''to'', t.file_path)), ''[]'')
                    from rcm.%I t join rcm.%I s on s.id = t.master_id
                    where t.master_hash is not null and t.file_path is not null and s.file_path is not null and t.file_path <> s.file_path
                      and exists (select 1 from storage.objects o where o.bucket_id = ''payer-forms'' and o.name = s.file_path)
                      and not exists (select 1 from storage.objects o where o.bucket_id = ''payer-forms'' and o.name = t.file_path)',
                   v_tgt || 'payer_forms', m.prefix || 'payer_forms') into v_add;
    v_out := v_out || v_add;
  end if;
  if to_regclass(format('rcm.%I', v_tgt || 'sop_media')) is not null then
    execute format('select coalesce(jsonb_agg(jsonb_build_object(''bucket'', ''sop-media'', ''from'', s.path, ''to'', t.path)), ''[]'')
                    from rcm.%I t join rcm.%I s on s.id = t.master_id
                    where t.master_hash is not null and t.path <> s.path
                      and exists (select 1 from storage.objects o where o.bucket_id = ''sop-media'' and o.name = s.path)
                      and not exists (select 1 from storage.objects o where o.bucket_id = ''sop-media'' and o.name = t.path)',
                   v_tgt || 'sop_media', m.prefix || 'sop_media') into v_add;
    v_out := v_out || v_add;
  end if;
  return v_out;
end;
$$;
revoke all on function rcm.owner_master_files(text, text, text) from public;
grant execute on function rcm.owner_master_files(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
