import { useState, useEffect } from 'react';
import { S, kv, refreshCompanyProcesses } from '../../lib/supabase';
import { DEFAULT_PROJECT, DEF_PROCS, TEAMS } from '../../lib/constants';
import { DEFAULT_SUPERVISOR_PERMS, NO_PERMS, permsFor, subProcessesOf, logAudit, today, effectiveTarget } from '../../lib/helpers';
import { FEATURES, hasRoleDefault, grantsOf } from '../../lib/access';
import Modal from '../../components/shared/Modal';
import { confirmDialog, alertDialog } from '../../components/shared/Dialog';
import { seatLimitProblem } from '../../lib/company';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const ROLES     = ['employee', 'supervisor', 'manager', 'admin'];
const BLANK     = {
  emp_id: '', name: '', password: '', access: 'MCO',
  role: 'employee', target: '', processes: ['MCO'], supervisor_ids: [], team_emp_ids: [],
  supervised_processes: [], supervised_projects: [], all_projects: false,
  permissions: NO_PERMS,   // employees: view-only in any monitoring page they're granted
  ramp_enabled: false, ramp_schedule: [], ramp_start_date: '',
  team: '', is_qa: false, access_grants: {},
};

const PERM_LABELS = {
  resetPassword:  'Reset employee password',
  bypassDeadline: 'Bypass deadline / attendance',
  editCounts:     'Edit submitted counts',
  editQuality:    'Edit quality score',
  pinEmployee:    'Pin employee for close monitoring',
};

// Pages with edit actions controlled by the Permissions checkboxes
const MONITOR_FEATURES = ['page_today', 'page_prodmonitor', 'page_hourly', 'page_quality'];
const hasMonitorGrant = form => form.role === 'employee' && MONITOR_FEATURES.some(k => form.access_grants?.[k]);

function rampWeek(u) {
  if (!u.ramp_enabled || !Array.isArray(u.ramp_schedule) || !u.ramp_schedule.length || !u.ramp_start_date) return null;
  const weeksElapsed = Math.floor((new Date(today()) - new Date(u.ramp_start_date)) / (7 * 86400000));
  if (weeksElapsed < 0 || weeksElapsed >= u.ramp_schedule.length) return null;
  return { week: weeksElapsed + 1, total: u.ramp_schedule.length };
}

function SortableRow({ u, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: u.emp_id });
  return (
    <tr
      ref={setNodeRef}
      style={{
        opacity: !u.active ? 0.5 : isDragging ? 0.6 : undefined,
        transform: CSS.Transform.toString(transform),
        transition,
        background: isDragging ? 'var(--bg-hover, rgba(0,0,0,0.04))' : undefined,
      }}
    >
      <td style={{ width: 28, cursor: 'grab', touchAction: 'none', color: 'var(--text-muted)' }} {...attributes} {...listeners}>⠿</td>
      {children}
    </tr>
  );
}

function MultiCheck({ label, options, groups, selected, onChange }) {
  const renderOpt = opt => (
    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={selected.includes(opt)}
        onChange={e => onChange(e.target.checked ? [...selected, opt] : selected.filter(s => s !== opt))}
      />
      {opt}
    </label>
  );
  return (
    <div className="field">
      <label>{label}</label>
      {groups ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {groups.filter(([, opts]) => opts.length > 0).map(([proj, opts]) => (
            <div key={proj}>
              <div className="text-sm text-muted" style={{ marginBottom: 3 }}>{proj}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{opts.map(renderOpt)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
          {options.map(renderOpt)}
        </div>
      )}
    </div>
  );
}

export default function TeamMgmt({ user }) {
  const [allUsers, setAllUsers]       = useState([]);
  const [resetReqs, setResetReqs]     = useState([]);
  const [customProcs, setCustomProcs] = useState([]);
  const [search, setSearch]           = useState('');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [procFilter, setProcFilter]   = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('active');
  const [teamFilter, setTeamFilter]   = useState('ALL');
  const [loading, setLoading]         = useState(false);
  const [showForm, setShowForm]       = useState(false);
  const [editUser, setEditUser]       = useState(null);
  const [form, setForm]               = useState(BLANK);
  const [saving, setSaving]           = useState(false);
  const [projForm, setProjForm]       = useState(null);    // Add Project modal { project, locked, subs, error }
  const [projSaving, setProjSaving]   = useState(false);
  const [procEdit, setProcEdit]       = useState(null);    // Edit Sub-Process modal
  const [projEdit, setProjEdit]       = useState(null);    // Edit Project modal
  const [editSaving, setEditSaving]   = useState(false);
  const [rowOrder, setRowOrder]       = useState({});
  const [qualitySkipProcs, setQualitySkipProcs] = useState(new Set());

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [u, rr, cp, skipList] = await Promise.all([
      S.get('users'),
      S.get('reset_requests'),
      S.get('processes'),
      kv.get('quality_skip_procs'),
    ]);
    setAllUsers(u ?? []);
    setResetReqs(rr ?? []);
    setCustomProcs(cp ?? []);
    refreshCompanyProcesses().catch(() => {});   // keep other pages' process filters current
    setQualitySkipProcs(new Set(skipList ?? []));
    setLoading(false);
  }

  async function toggleQualitySkip(procName) {
    const skipping = !qualitySkipProcs.has(procName);
    if (!await confirmDialog({
      title: skipping ? `Skip quality review for ${procName}?` : `Track quality for ${procName}?`,
      message: skipping ? 'It will no longer show "Pending" in Quality Monitor.' : 'It will show "Pending" in Quality Monitor until a quality score is entered.',
      confirmText: 'Confirm',
    })) return;
    const next = new Set(qualitySkipProcs);
    if (next.has(procName)) next.delete(procName); else next.add(procName);
    setQualitySkipProcs(next);
    await kv.set('quality_skip_procs', [...next]);
  }

  const allProjects  = [DEFAULT_PROJECT, ...new Set(customProcs.map(p => p.project).filter(p => p && p !== DEFAULT_PROJECT))]
    .filter(proj => subProcessesOf(proj, customProcs).length > 0);   // added companies have no built-in PMB processes
  const procsByProject = Object.fromEntries(allProjects.map(proj => [proj, subProcessesOf(proj, customProcs)]));
  const allProcs     = Object.values(procsByProject).flat();
  const projectOfProc = Object.fromEntries(allProjects.flatMap(proj => procsByProject[proj].map(p => [p, proj])));
  const supervisors  = allUsers.filter(u => u.role === 'supervisor' || u.role === 'manager' || u.role === 'admin');
  const pendingResets = (resetReqs ?? []).filter(r => r.status === 'pending');
  // Team/QA columns come from supabase/migrations/20261018_add_user_team.sql — until it
  // has been run (and synced to this company), saving them would fail, so leave them out.
  const hasTeamCols  = allUsers.some(u => 'team' in u);
  // Same for users.can_view_audit (20261018b_audit_log.sql) and users.access_grants (20261018c_clients_payers.sql)
  const hasAuditCol  = allUsers.some(u => 'can_view_audit' in u);
  const hasGrantsCol = allUsers.some(u => 'access_grants' in u);
  // Extra access an admin can grant; only "View Audit Log" until access_grants exists
  const grantable    = hasGrantsCol ? FEATURES : hasAuditCol ? FEATURES.filter(ft => ft.key === 'audit_view') : [];
  const canGrant     = user.role === 'admin';

  const displayUsers = allUsers.filter(u => {
    const q      = search.toLowerCase();
    const nameOk = !q || (u.name ?? '').toLowerCase().includes(q) || (u.emp_id ?? '').toLowerCase().includes(q);
    const userProcFields = [u.access, u.process, ...(u.processes ?? [])];
    const clientOk = clientFilter === 'ALL' ||
      userProcFields.some(p => p === 'ALL' || (p && projectOfProc[p] === clientFilter));
    const procOk = procFilter === 'ALL' || u.access === procFilter || u.access === 'ALL' ||
      u.process === procFilter || u.process === 'ALL' || (u.processes ?? []).includes(procFilter);
    const statusOk = statusFilter === 'all' ||
      (statusFilter === 'active' ? u.active !== false : u.active === false);
    const teamOk = teamFilter === 'ALL' ||
      (teamFilter === 'QA' ? !!u.is_qa : teamFilter === 'NONE' ? !u.team : u.team === teamFilter);
    return nameOk && clientOk && procOk && statusOk && teamOk;
  });

  const groupedUsers = (() => {
    const groups = {};
    for (const u of displayUsers) {
      const key = u.access || u.process || 'Unassigned';
      (groups[key] ??= []).push(u);
    }
    const orderedKeys = [...allProcs.filter(p => groups[p]), ...Object.keys(groups).filter(k => !allProcs.includes(k))];
    return orderedKeys.map(key => {
      const users = groups[key];
      const savedOrder = rowOrder[key] ?? [];
      const byId = Object.fromEntries(users.map(u => [u.emp_id, u]));
      const sorted = [
        ...savedOrder.filter(id => byId[id]).map(id => byId[id]),
        ...users.filter(u => !savedOrder.includes(u.emp_id)),
      ];
      return [key, sorted];
    });
  })();

  // Nest sub-process groups under their client/project so the list stays organized as clients grow
  const groupedByProject = [
    ...allProjects.map(proj => [proj, groupedUsers.filter(([key]) => projectOfProc[key] === proj)]),
    ['Unassigned', groupedUsers.filter(([key]) => !projectOfProc[key])],
  ].filter(([, subs]) => subs.length > 0);

  function handleDragEnd(groupKey, event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = (groupedUsers.find(([k]) => k === groupKey)?.[1] ?? []).map(u => u.emp_id);
    const from = ids.indexOf(active.id);
    const to   = ids.indexOf(over.id);
    if (from === -1 || to === -1) return;
    setRowOrder(prev => ({ ...prev, [groupKey]: arrayMove(ids, from, to) }));
  }

  const setF = patch => setForm(prev => ({ ...prev, ...patch }));

  function openCreate() {
    setEditUser(null);
    setForm({ ...BLANK, access: allProcs[0] ?? 'ALL', processes: allProcs.slice(0, 1) });
    setShowForm(true);
  }
  function openEdit(u) {
    setEditUser(u);
    setForm({
      emp_id: u.emp_id, name: u.name ?? '',
      password: u.password ?? '', access: u.access || u.process || 'MCO',
      role: u.role ?? 'employee', target: u.target ?? '',
      processes: u.processes ?? [u.access || u.process || 'MCO'],
      supervisor_ids: u.supervisor_ids ?? [],
      team_emp_ids: u.role === 'supervisor'
        ? allUsers.filter(e => e.role === 'employee' && (e.supervisor_ids ?? []).includes(u.emp_id)).map(e => e.emp_id)
        : [],
      supervised_processes: u.supervised_processes ?? [],
      supervised_projects: (u.supervised_projects ?? []).filter(p => p !== 'ALL'),
      all_projects: (u.supervised_projects ?? []).includes('ALL'),
      permissions: permsFor(u),
      ramp_enabled: u.ramp_enabled ?? false,
      ramp_schedule: u.ramp_schedule ?? [],
      ramp_start_date: u.ramp_start_date ?? '',
      team: u.team ?? '',
      is_qa: !!u.is_qa,
      access_grants: grantsOf(u),
    });
    setShowForm(true);
  }

  async function saveUser() {
    if (!form.emp_id.trim() || !form.name.trim()) return;
    if (!editUser) {   // Owner Console 2.0: the company's seat limit
      const problem = await seatLimitProblem();
      if (problem) { await alertDialog({ title: 'User limit reached', message: problem, tone: 'warning' }); return; }
    }
    if (!await confirmDialog(editUser
      ? { title: 'Save changes?', message: `Update ${form.name.trim()} (${editUser.emp_id}).`, confirmText: 'Save Changes' }
      : { title: 'Create this user?', message: `${form.name.trim()} (${form.emp_id.trim().toUpperCase()}) · ${form.role} · ${form.access}`, confirmText: 'Create User' })) return;
    setSaving(true);
    const empId = form.emp_id.trim().toUpperCase();
    const payload = {
      emp_id: empId,
      name: form.name.trim(),
      password: form.password,
      access: form.access,
      role: form.role,
      target: form.target !== '' ? parseInt(form.target) : null,
      processes: form.processes,
      supervisor_ids: form.supervisor_ids,
      supervised_processes: form.role === 'supervisor' ? form.supervised_processes : [],
      supervised_projects: form.role === 'manager' ? (form.all_projects ? ['ALL'] : form.supervised_projects) : [],
      permissions: (form.role === 'supervisor' || form.role === 'manager' || hasMonitorGrant(form)) ? form.permissions : null,
      active: true,
      ramp_enabled: form.ramp_enabled,
      ramp_schedule: form.ramp_enabled ? form.ramp_schedule.map(Number) : null,
      ramp_start_date: form.ramp_enabled ? (form.ramp_start_date || editUser?.ramp_start_date || today()) : null,
      ...(hasTeamCols ? { team: form.team || null, is_qa: !!form.is_qa } : {}),
    };
    // Individually granted access — role defaults aren't stored, so a role change keeps them
    const newGrants = Object.fromEntries(grantable
      .filter(ft => !hasRoleDefault(form.role, ft.key) && form.access_grants?.[ft.key])
      .map(ft => [ft.key, true]));
    if (hasGrantsCol) payload.access_grants = newGrants;
    if (hasAuditCol)  payload.can_view_audit = !!newGrants.audit_view;
    const result = editUser
      ? await S.update('users', payload, { emp_id: editUser.emp_id })
      : await S.set('users', payload);
    setSaving(false);
    if (!result) {
      await alertDialog({ title: 'Could not save user', message: 'The ID may already exist, or the save was blocked by a database permission rule.', tone: 'danger' });
      return;
    }
    // Record which fields changed — never their values for the password
    const changed = editUser
      ? Object.keys(payload).filter(k => k !== 'active' && JSON.stringify(payload[k] ?? null) !== JSON.stringify(editUser[k] ?? null))
      : null;
    logAudit({
      actor: user, action: editUser ? 'edit_user' : 'create_user', targetEmpId: empId, targetName: form.name.trim(),
      entityType: 'user', entityId: empId,
      details: editUser ? { changed } : { role: form.role, access: form.access },
    });
    const prevGrants = editUser ? grantsOf(editUser) : {};
    for (const ft of grantable) {
      if (!!newGrants[ft.key] === !!prevGrants[ft.key]) continue;
      logAudit({
        actor: user, action: newGrants[ft.key] ? 'grant_access' : 'revoke_access',
        targetEmpId: empId, targetName: form.name.trim(), entityType: 'user', entityId: empId,
        details: { access: ft.label },
      });
    }
    const prevTeam = editUser?.team ?? null;
    const prevQa   = !!editUser?.is_qa;
    if (hasTeamCols && ((form.team || null) !== prevTeam || !!form.is_qa !== prevQa)) {
      logAudit({
        actor: user, action: 'set_team', targetEmpId: empId, targetName: form.name.trim(),
        details: { team: form.team || null, is_qa: !!form.is_qa, previous_team: prevTeam, previous_is_qa: prevQa },
      });
    }
    if (form.role === 'supervisor') {
      // Reconcile the other side of the relationship: each employee's own supervisor_ids
      // array is the source of truth, so adding/removing someone from "Team Members" here
      // means adding/removing this supervisor's emp_id on those employee rows.
      const newTeam = new Set(form.team_emp_ids ?? []);
      const affected = allUsers.filter(e =>
        e.role === 'employee' && ((e.supervisor_ids ?? []).includes(empId) || newTeam.has(e.emp_id))
      );
      await Promise.all(affected.map(e => {
        const cur = new Set(e.supervisor_ids ?? []);
        if (newTeam.has(e.emp_id)) cur.add(empId); else cur.delete(empId);
        return S.update('users', { supervisor_ids: [...cur] }, { emp_id: e.emp_id });
      }));
      logAudit({ actor: user, action: 'assign_team', targetEmpId: empId, targetName: form.name.trim(), details: { team: [...newTeam] } });
    }
    setShowForm(false);
    await load();
  }

  async function toggleActive(u) {
    if (!u.active) {   // Owner Console 2.0: reactivating counts against the seat limit
      const problem = await seatLimitProblem();
      if (problem) { await alertDialog({ title: 'User limit reached', message: problem, tone: 'warning' }); return; }
    }
    if (!await confirmDialog(u.active
      ? { title: 'Deactivate this user?', message: `${u.name ?? u.emp_id} won't be able to sign in until reactivated. No data is deleted.`, tone: 'danger', confirmText: 'Deactivate' }
      : { title: 'Activate this user?', message: `${u.name ?? u.emp_id} will be able to sign in again.`, confirmText: 'Activate' })) return;
    await S.update('users', { active: !u.active }, { emp_id: u.emp_id });
    logAudit({
      actor: user, action: u.active ? 'deactivate_user' : 'activate_user',
      targetEmpId: u.emp_id, targetName: u.name, entityType: 'user', entityId: u.emp_id,
    });
    setAllUsers(prev => prev.map(x => x.emp_id === u.emp_id ? { ...x, active: !x.active } : x));
  }

  async function approveReset(rr) {
    if (!await confirmDialog({ title: 'Reset password?', message: `A temporary password will be created for ${rr.emp_name ?? rr.emp_id}.`, tone: 'warning', confirmText: 'Reset Password' })) return;
    const temp = `Temp@${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await S.update('users', { password: temp }, { emp_id: rr.emp_id });
    await S.update('reset_requests', { status: 'approved', temp_password: temp }, { id: rr.id });
    logAudit({ actor: user, action: 'reset_password', targetEmpId: rr.emp_id, targetName: rr.emp_name });
    await alertDialog({ title: 'Password reset', message: `Employee: ${rr.emp_name ?? rr.emp_id}\nTemporary password: ${temp}\n\nShare it securely.`, tone: 'success' });
    await load();
  }

  // Add Project modal — a new project with its sub-processes, or more
  // sub-processes for an existing project (project field locked)
  function openProjectForm(project = null) {
    setProjForm({ project: project ?? '', locked: !!project, subs: [''], error: '' });
  }

  async function saveProject() {
    const project = projForm.project.trim().toUpperCase();
    const subs = [...new Set(projForm.subs.map(s => s.trim().toUpperCase()).filter(Boolean))];
    const fail = error => setProjForm(p => ({ ...p, error }));
    if (!project) return fail('Enter a project name (e.g. your client or department).');
    if (!subs.length) return fail('Add at least one sub-process.');
    const taken = subs.filter(s => allProcs.includes(s));
    if (taken.length) return fail(`Already exists: ${taken.join(', ')}. Sub-process names must be unique.`);
    if (!await confirmDialog({
      title: projForm.locked ? 'Add these sub-processes?' : 'Create this project?',
      message: `Project: ${project}\nSub-processes: ${subs.join(', ')}`,
      confirmText: projForm.locked ? 'Add' : 'Create Project',
    })) return;
    setProjSaving(true);
    const results = await Promise.all(subs.map(name => S.set('processes', { name, project, active: true })));
    setProjSaving(false);
    if (results.some(r => !r)) return fail('Some sub-processes could not be saved. Please try again.');
    setProjForm(null);
    await load();
  }

  // ── Edit / delete a sub-process or a project (opened by clicking it) ──────
  // Renames carry over to task configs, users' process assignments and the
  // quality-skip list. Past daily reports keep the name they were filed under.
  const swap = (arr, from, to) => (Array.isArray(arr) ? arr.map(x => (x === from ? to : x)) : arr);

  async function renameProcessRefs(from, to) {
    await S.update('task_configs', { process: to }, { process: from });
    const touched = allUsers.filter(u =>
      u.access === from || (u.processes ?? []).includes(from) || (u.supervised_processes ?? []).includes(from));
    await Promise.all(touched.map(u => S.update('users', {
      access: u.access === from ? to : u.access,
      processes: swap(u.processes, from, to),
      supervised_processes: swap(u.supervised_processes, from, to),
    }, { emp_id: u.emp_id })));
    if (qualitySkipProcs.has(from)) await kv.set('quality_skip_procs', swap([...qualitySkipProcs], from, to));
  }

  function openProcEdit(p) {
    setProcEdit({ id: p.id, oldName: p.name, name: p.name, oldProject: p.project ?? DEFAULT_PROJECT, project: p.project ?? DEFAULT_PROJECT, error: '' });
  }

  async function saveProcEdit() {
    const name = procEdit.name.trim().toUpperCase();
    const project = procEdit.project.trim().toUpperCase();
    const fail = error => setProcEdit(p => ({ ...p, error }));
    if (!name) return fail('Enter a sub-process name.');
    if (!project) return fail('Choose a project.');
    if (name === procEdit.oldName && project === procEdit.oldProject) { setProcEdit(null); return; }
    if (name !== procEdit.oldName && allProcs.includes(name)) return fail(`${name} already exists. Sub-process names must be unique.`);
    const changes = [
      name !== procEdit.oldName && `Rename ${procEdit.oldName} → ${name}`,
      project !== procEdit.oldProject && `Move from ${procEdit.oldProject} to ${project}`,
    ].filter(Boolean).join('\n');
    if (!await confirmDialog({
      title: 'Save sub-process changes?',
      message: changes + (name !== procEdit.oldName ? '\n\nIts tasks and assigned users move to the new name. Past reports keep the old name.' : ''),
      confirmText: 'Save Changes',
    })) return;
    setEditSaving(true);
    const ok = await S.update('processes', { name, project }, { id: procEdit.id });
    if (ok && name !== procEdit.oldName) await renameProcessRefs(procEdit.oldName, name);
    setEditSaving(false);
    if (!ok) return fail('Could not save. Please try again.');
    setProcEdit(null);
    await load();
  }

  async function deleteProcEdit() {
    const users = allUsers.filter(u => u.access === procEdit.oldName || (u.processes ?? []).includes(procEdit.oldName)).length;
    if (!await confirmDialog({
      title: `Delete ${procEdit.oldName}?`,
      message: `It will be removed from ${procEdit.oldProject}.` + (users ? `\n${users} user(s) are assigned to it and will need a new process.` : ''),
      tone: 'danger', confirmText: 'Delete',
    })) return;
    setEditSaving(true);
    await S.del('processes', { id: procEdit.id });
    setEditSaving(false);
    setProcEdit(null);
    await load();
  }

  async function saveProjEdit() {
    const name = projEdit.name.trim().toUpperCase();
    const fail = error => setProjEdit(p => ({ ...p, error }));
    if (!name) return fail('Enter a project name.');
    if (name === projEdit.oldName) { setProjEdit(null); return; }
    if (allProjects.includes(name)) return fail(`A project called ${name} already exists.`);
    if (!await confirmDialog({ title: 'Rename project?', message: `${projEdit.oldName} → ${name}\nAll of its sub-processes move with it.`, confirmText: 'Rename' })) return;
    setEditSaving(true);
    const ok = await S.update('processes', { project: name }, { project: projEdit.oldName });
    const managers = allUsers.filter(u => (u.supervised_projects ?? []).includes(projEdit.oldName));
    await Promise.all(managers.map(u => S.update('users', { supervised_projects: swap(u.supervised_projects, projEdit.oldName, name) }, { emp_id: u.emp_id })));
    setEditSaving(false);
    if (!ok) return fail('Could not save. Please try again.');
    setProjEdit(null);
    await load();
  }

  async function deleteProjEdit() {
    const subs = customProcs.filter(p => (p.project ?? DEFAULT_PROJECT) === projEdit.oldName);
    if (!await confirmDialog({
      title: `Delete project ${projEdit.oldName}?`,
      message: `Its sub-processes will be deleted too: ${subs.map(p => p.name).join(', ')}.\nUsers assigned to them will need a new process.`,
      tone: 'danger', confirmText: 'Delete Project',
    })) return;
    setEditSaving(true);
    await Promise.all(subs.map(p => S.del('processes', { id: p.id })));
    setEditSaving(false);
    setProjEdit(null);
    await load();
  }

  const f = form;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Team Management</div>
          <div className="page-subtitle">
            {allUsers.length} users
            {pendingResets.length > 0 && (
              <span className="col-red" style={{ marginLeft: 8 }}>· {pendingResets.length} reset request(s)</span>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn-sm" onClick={() => openProjectForm()}>+ Add Project</button>
          <button className="btn-primary" onClick={openCreate}>+ Add User</button>
        </div>
      </div>

      {/* Password reset approvals */}
      {pendingResets.length > 0 && (
        <div className="card mb-16" style={{ borderColor: 'var(--warning)', borderWidth: 2 }}>
          <div className="card-header">
            <div className="card-title" style={{ color: 'var(--warning)' }}>⚠ Password Reset Requests</div>
            <span className="badge badge-yellow">{pendingResets.length} pending</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Employee</th><th>ID</th><th>Requested</th><th>Action</th></tr>
              </thead>
              <tbody>
                {pendingResets.map(rr => (
                  <tr key={rr.id}>
                    <td className="bold">{rr.emp_name ?? rr.emp_id}</td>
                    <td>{rr.emp_id}</td>
                    <td className="text-sm text-muted">
                      {rr.requested_at ? new Date(rr.requested_at).toLocaleString() : '—'}
                    </td>
                    <td>
                      <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => approveReset(rr)}>
                        Approve & Reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Process management */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Projects &amp; Sub-Processes</div>
          <button className="btn-sm" onClick={() => openProjectForm()}>+ Add Project</button>
        </div>
        {allProjects.length === 0 ? (
          <p className="text-muted text-sm" style={{ padding: '6px 0' }}>
            No projects yet. Click <strong>+ Add Project</strong> to create your first project and its sub-processes,
            then set each sub-process's tasks and weightage in <strong>Settings</strong>.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th style={{ width: 160 }}>Project</th><th>Sub-Processes</th><th className="right"></th></tr>
              </thead>
              <tbody>
                {allProjects.map(proj => (
                  <tr key={proj}>
                    <td className="bold">{proj}</td>
                    <td>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {procsByProject[proj].map(name => {
                          const custom = customProcs.find(p => p.name === name && (p.project ?? DEFAULT_PROJECT) === proj);
                          // Built-in processes (home company) can't be edited; custom ones open the edit pop-up
                          return custom ? (
                            <button key={name} type="button" className="badge badge-yellow" onClick={() => openProcEdit(custom)}
                              title={`Edit or delete ${name}`} style={{ border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 11 }}>
                              {name}
                            </button>
                          ) : (
                            <span key={name} className="badge badge-blue" title="Built-in process">{name}</span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-sm" onClick={() => openProjectForm(proj)}>+ Sub-Process</button>{' '}
                      {!(DEF_PROCS.length && proj === DEFAULT_PROJECT) && (
                        <button className="btn-sm" onClick={() => setProjEdit({ oldName: proj, name: proj, error: '' })}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-muted" style={{ marginTop: 8 }}>Click a sub-process to rename, move or delete it.</p>
          </div>
        )}
        {allProjects.length > 0 && <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div className="text-sm bold" style={{ marginBottom: 6 }}>Quality Tracking</div>
          <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
            Processes checked below will not show "Pending" in Quality Monitor — they are not subject to quality review.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allProjects.map(proj => (
              <div key={proj}>
                <div className="text-sm text-muted" style={{ marginBottom: 3 }}>{proj}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {procsByProject[proj].map(proc => (
                    <label key={proc} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={qualitySkipProcs.has(proc)}
                        onChange={() => toggleQualitySkip(proc)}
                      />
                      {proc}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>}
      </div>

      {/* User list */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">User Directory</div>
          <div className="row" style={{ gap: 8 }}>
            <input type="text" placeholder="Search name / ID…" value={search}
              onChange={e => setSearch(e.target.value)} style={{ maxWidth: 180 }} />
            <select value={clientFilter} onChange={e => { setClientFilter(e.target.value); setProcFilter('ALL'); }} style={{ maxWidth: 140 }}>
              <option value="ALL">All Clients</option>
              {allProjects.map(p => <option key={p}>{p}</option>)}
            </select>
            <select value={procFilter} onChange={e => setProcFilter(e.target.value)} style={{ maxWidth: 150 }}>
              <option value="ALL">All Sub-Processes</option>
              {(clientFilter === 'ALL' ? allProcs : procsByProject[clientFilter] ?? []).map(p => <option key={p}>{p}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 120 }}>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="all">All</option>
            </select>
            {hasTeamCols && (
              <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={{ maxWidth: 150 }}>
                <option value="ALL">All Teams</option>
                {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="QA">QA reviewers</option>
                <option value="NONE">No team set</option>
              </select>
            )}
          </div>
        </div>
        {loading && <div style={{ textAlign: 'center', padding: 24 }}>Loading…</div>}
        {!loading && groupedByProject.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No users found</div>
        )}
        {!loading && groupedByProject.map(([proj, subGroups]) => (
          <div key={proj} style={{ marginBottom: 22 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 6px',
              borderBottom: '2px solid var(--border)', marginBottom: 4,
            }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>{proj === 'Unassigned' ? '⚠️' : '🏢'} {proj}</span>
              <span className="badge badge-blue">
                {subGroups.reduce((s, [, us]) => s + us.length, 0)} user{subGroups.reduce((s, [, us]) => s + us.length, 0) !== 1 ? 's' : ''}
              </span>
            </div>
            {subGroups.map(([groupKey, users]) => (
              <div key={groupKey} style={{ marginBottom: 18, marginLeft: 14 }}>
                <div className="text-sm bold text-muted" style={{ margin: '10px 0 4px' }}>{groupKey}</div>
                <div className="table-wrap">
                  <DndContext sensors={dndSensors} onDragEnd={e => handleDragEnd(groupKey, e)}>
                    <table>
                      <thead>
                        <tr>
                          <th></th>
                          <th>Emp ID</th>
                          <th>Name</th>
                          <th>Role</th>
                          {hasTeamCols && <th>Team</th>}
                          <th>Process</th>
                          <th className="right">Target</th>
                          <th className="center">Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        <SortableContext items={users.map(u => u.emp_id)} strategy={verticalListSortingStrategy}>
                          {users.map(u => (
                            <SortableRow key={u.emp_id} u={u}>
                              <td className="bold text-sm">{u.emp_id}</td>
                              <td>{u.name ?? '—'}</td>
                              <td>
                                <span className={`badge ${u.role === 'admin' ? 'badge-blue' : u.role === 'manager' ? 'badge-purple' : u.role === 'supervisor' ? 'badge-yellow' : 'badge-gray'}`}>
                                  {u.role}
                                </span>
                              </td>
                              {hasTeamCols && (
                                <td>
                                  <div className="row" style={{ gap: 4 }}>
                                    {u.team ? <span className="badge badge-blue">{u.team}</span> : <span className="text-muted">—</span>}
                                    {u.is_qa && <span className="badge badge-purple">QA</span>}
                                  </div>
                                </td>
                              )}
                              <td>{u.access || u.process || '—'}</td>
                              <td className="right">{u.target ?? '—'}</td>
                              <td className="center">
                                <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
                                  <span className={`badge ${u.active !== false ? 'badge-green' : 'badge-red'}`}>
                                    {u.active !== false ? 'Active' : 'Disabled'}
                                  </span>
                                  {rampWeek(u) && <span className="badge badge-yellow">Ramp Wk {rampWeek(u).week}/{rampWeek(u).total}</span>}
                                </div>
                              </td>
                              <td>
                                <div className="row" style={{ gap: 4 }}>
                                  <button className="btn-sm" onClick={() => openEdit(u)}>Edit</button>
                                  <button className="btn-sm"
                                    style={{ color: u.active !== false ? 'var(--danger)' : 'var(--success)' }}
                                    onClick={() => toggleActive(u)}>
                                    {u.active !== false ? 'Disable' : 'Enable'}
                                  </button>
                                </div>
                              </td>
                            </SortableRow>
                          ))}
                        </SortableContext>
                      </tbody>
                    </table>
                  </DndContext>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Create / Edit user modal */}
      {showForm && (
        <Modal title={editUser ? `Edit — ${editUser.emp_id}` : 'Create New User'} onClose={() => setShowForm(false)} wide>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Employee ID</label>
                <input type="text" value={f.emp_id} onChange={e => setF({ emp_id: e.target.value })}
                  placeholder="EMP001" disabled={!!editUser} />
              </div>
              <div className="field">
                <label>Full Name</label>
                <input type="text" value={f.name} onChange={e => setF({ name: e.target.value })} placeholder="Full name" />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="text" value={f.password} onChange={e => setF({ password: e.target.value })} placeholder="Set password" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={f.role} onChange={e => setF({ role: e.target.value, permissions: permsFor({ role: e.target.value, permissions: editUser?.permissions }) })}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Primary Access</label>
                <select value={f.access} onChange={e => setF({ access: e.target.value })}>
                  {allProjects.map(proj => (
                    <optgroup key={proj} label={proj}>
                      {procsByProject[proj].map(p => <option key={p} value={p}>{p}</option>)}
                    </optgroup>
                  ))}
                  <option value="ALL">ALL</option>
                </select>
              </div>
              <div className="field">
                <label>Daily Target</label>
                <input type="number" value={f.target} onChange={e => setF({ target: e.target.value })} placeholder="e.g. 100" />
              </div>
              <div className="field">
                <label>Team</label>
                <select value={f.team} onChange={e => setF({ team: e.target.value })} disabled={!hasTeamCols}>
                  <option value="">— Not set —</option>
                  {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: hasTeamCols ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={f.is_qa} disabled={!hasTeamCols}
                    onChange={e => setF({ is_qa: e.target.checked })} />
                  QA reviewer (audits other people’s work)
                </label>
              </div>
            </div>
            {grantable.length > 0 && (
              <div className="field">
                <label>Extra access</label>
                {[...new Set(grantable.map(ft => ft.group))].map(group => (
                  <div key={group} style={{ marginTop: 6 }}>
                    <div className="text-sm text-muted" style={{ marginBottom: 3 }}>{group}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                      {grantable.filter(ft => ft.group === group).map(ft => {
                        const byRole = hasRoleDefault(f.role, ft.key);
                        return (
                          <label key={ft.key} title={ft.warning ?? ''}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: byRole || !canGrant ? 'default' : 'pointer' }}>
                            <input type="checkbox" disabled={byRole || !canGrant}
                              checked={byRole || !!f.access_grants?.[ft.key]}
                              onChange={e => setF({ access_grants: { ...f.access_grants, [ft.key]: e.target.checked } })} />
                            {ft.label}
                            {ft.warning && !byRole && <span style={{ color: 'var(--warning)' }} aria-label={ft.warning}>⚠</span>}
                            {byRole ? <span className="text-muted">(all {f.role}s)</span> : ''}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {grantable.some(ft => ft.warning && !hasRoleDefault(f.role, ft.key) && f.access_grants?.[ft.key]) && (
                  <div className="text-sm" style={{ marginTop: 6, color: 'var(--warning)' }}>
                    ⚠ {grantable.filter(ft => ft.warning && !hasRoleDefault(f.role, ft.key) && f.access_grants?.[ft.key])
                      .map(ft => `${ft.label}: ${ft.warning.toLowerCase()}`).join(' · ')}.
                  </div>
                )}
                <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                  For employees, granted monitoring pages show only the sub-processes ticked under Permissions,
                  and are view-only unless you tick actions at the bottom of this form. Changes apply at their next sign-in.
                </div>
                {!canGrant && (
                  <div className="text-sm text-muted" style={{ marginTop: 4 }}>Only an admin can change extra access.</div>
                )}
              </div>
            )}
            {!hasTeamCols && (
              <div className="text-sm text-muted">
                Team and QA can be set once the database update for roadmap step 0.3 has been run
                (supabase/migrations/20261018_add_user_team.sql, then “Sync structure” in the Owner Console).
              </div>
            )}
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={f.ramp_enabled}
                  onChange={e => setF({ ramp_enabled: e.target.checked, ramp_schedule: e.target.checked && f.ramp_schedule.length === 0 ? [''] : f.ramp_schedule })} />
                Ramp-Up Plan (new hire starts below the Daily Target and steps up week by week)
              </label>
              {f.ramp_enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span className="text-sm text-muted" style={{ width: 80 }}>Start Date</span>
                    <input type="date" value={f.ramp_start_date} style={{ maxWidth: 160 }}
                      onChange={e => setF({ ramp_start_date: e.target.value })} />
                  </div>
                  {f.ramp_schedule.map((wk, i) => (
                    <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="text-sm text-muted" style={{ width: 56 }}>Week {i + 1}</span>
                      <input type="number" value={wk} style={{ maxWidth: 120 }}
                        onChange={e => setF({ ramp_schedule: f.ramp_schedule.map((v, j) => j === i ? e.target.value : v) })}
                        placeholder="Target" />
                      <button className="btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={() => setF({ ramp_schedule: f.ramp_schedule.filter((_, j) => j !== i) })}>Remove</button>
                    </div>
                  ))}
                  <button className="btn-sm" style={{ alignSelf: 'flex-start' }}
                    onClick={() => setF({ ramp_schedule: [...f.ramp_schedule, ''] })}>+ Add Week</button>
                  <div className="text-sm text-muted">After the schedule ends, the Daily Target above applies automatically.</div>
                </div>
              )}
            </div>
            <MultiCheck label="Permissions" groups={allProjects.map(p => [p, procsByProject[p]])} selected={f.processes}
              onChange={v => setF({ processes: v })} />
            {f.role === 'employee' && supervisors.length > 0 && (
              <MultiCheck
                label="Supervisor Access (who can see this user)"
                options={supervisors.map(s => s.emp_id)}
                selected={f.supervisor_ids}
                onChange={v => setF({ supervisor_ids: v })}
              />
            )}
            {f.role === 'supervisor' && (
              <>
                <MultiCheck
                  label="Monitored Processes (auto-includes everyone on these processes)"
                  groups={allProjects.map(p => [p, procsByProject[p]])}
                  selected={f.supervised_processes}
                  onChange={v => setF({ supervised_processes: v })}
                />
                <MultiCheck
                  label="Team Members (additional individual employees this supervisor monitors)"
                  options={allUsers.filter(u => u.role === 'employee').map(u => u.emp_id)}
                  selected={f.team_emp_ids}
                  onChange={v => setF({ team_emp_ids: v })}
                />
              </>
            )}
            {f.role === 'manager' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={f.all_projects} onChange={e => setF({ all_projects: e.target.checked })} />
                  All Projects (sees every project, current and future)
                </label>
                {!f.all_projects && (
                  <MultiCheck
                    label="Projects (grants every sub-process under each, including future ones)"
                    options={allProjects}
                    selected={f.supervised_projects}
                    onChange={v => setF({ supervised_projects: v })}
                  />
                )}
              </>
            )}
            {(f.role === 'supervisor' || f.role === 'manager' || hasMonitorGrant(f)) && (
              <div className="field">
                <label>{f.role === 'employee' ? 'Actions allowed in granted monitoring pages (unticked = view-only)' : 'Permissions'}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 4 }}>
                  {Object.keys(DEFAULT_SUPERVISOR_PERMS).map(key => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!f.permissions[key]}
                        onChange={e => setF({ permissions: { ...f.permissions, [key]: e.target.checked } })} />
                      {PERM_LABELS[key] ?? key}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="form-actions">
              <button className="btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveUser}
                disabled={saving || !f.emp_id.trim() || !f.name.trim()}>
                {saving ? 'Saving…' : editUser ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add project / sub-process modal */}
      {projForm && (
        <Modal title={projForm.locked ? `Add Sub-Process — ${projForm.project}` : 'Add Project'} onClose={() => setProjForm(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label>Project name</label>
              <input type="text" value={projForm.project} disabled={projForm.locked} autoFocus={!projForm.locked}
                onChange={e => setProjForm(p => ({ ...p, project: e.target.value, error: '' }))}
                placeholder="e.g. your client or department" />
            </div>
            <div className="field">
              <label>Sub-processes</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {projForm.subs.map((s, i) => (
                  <div key={i} className="row" style={{ gap: 6 }}>
                    <input type="text" value={s} autoFocus={projForm.locked && i === projForm.subs.length - 1}
                      placeholder={`Sub-process ${i + 1} (e.g. AR Calling)`}
                      onChange={e => setProjForm(p => ({ ...p, error: '', subs: p.subs.map((x, j) => j === i ? e.target.value : x) }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setProjForm(p => ({ ...p, subs: [...p.subs, ''] })); } }} />
                    {projForm.subs.length > 1 && (
                      <button className="btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={() => setProjForm(p => ({ ...p, subs: p.subs.filter((_, j) => j !== i) }))}>Remove</button>
                    )}
                  </div>
                ))}
              </div>
              <button className="btn-link" style={{ width: 'auto', marginTop: 6 }}
                onClick={() => setProjForm(p => ({ ...p, subs: [...p.subs, ''] }))}>+ Add another sub-process</button>
            </div>
            <p className="text-sm text-muted">
              Next, set each sub-process's tasks and weightage in <strong>Settings → {DEF_PROCS.length ? 'Custom Process Task Configuration' : 'Productivity Tasks & Weightage'}</strong>.
            </p>
            {projForm.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{projForm.error}</p>}
            <div className="form-actions">
              <button className="btn-sm" onClick={() => setProjForm(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveProject} disabled={projSaving}>
                {projSaving ? 'Saving…' : projForm.locked ? 'Add Sub-Process' : 'Create Project'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit sub-process modal */}
      {procEdit && (
        <Modal title={`Edit Sub-Process — ${procEdit.oldName}`} onClose={() => setProcEdit(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label>Sub-process name</label>
              <input type="text" value={procEdit.name} autoFocus
                onChange={e => setProcEdit(p => ({ ...p, name: e.target.value, error: '' }))} />
            </div>
            <div className="field">
              <label>Project</label>
              <select value={procEdit.project} onChange={e => setProcEdit(p => ({ ...p, project: e.target.value, error: '' }))}>
                {allProjects.map(proj => <option key={proj} value={proj}>{proj}</option>)}
              </select>
            </div>
            {procEdit.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{procEdit.error}</p>}
            <div className="form-actions" style={{ justifyContent: 'space-between' }}>
              <button className="btn-danger" onClick={deleteProcEdit} disabled={editSaving}>Delete Sub-Process</button>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-sm" onClick={() => setProcEdit(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveProcEdit} disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit project modal */}
      {projEdit && (
        <Modal title={`Edit Project — ${projEdit.oldName}`} onClose={() => setProjEdit(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label>Project name</label>
              <input type="text" value={projEdit.name} autoFocus
                onChange={e => setProjEdit(p => ({ ...p, name: e.target.value, error: '' }))} />
            </div>
            <p className="text-sm text-muted">
              Sub-processes: {(procsByProject[projEdit.oldName] ?? []).join(', ') || '—'}
            </p>
            {projEdit.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{projEdit.error}</p>}
            <div className="form-actions" style={{ justifyContent: 'space-between' }}>
              <button className="btn-danger" onClick={deleteProjEdit} disabled={editSaving}>Delete Project</button>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-sm" onClick={() => setProjEdit(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveProjEdit} disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
