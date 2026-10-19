import { useState, useEffect } from 'react';
import { kv, S } from '../../lib/supabase';
import { DEFAULT_TASKS, DEF_PROCS } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';
import { logAudit } from '../../lib/helpers';

// Company name/code, adding companies and the version history are managed by the
// Helix Hub owner in the Owner Console, never from a company's own admin login.
// DEF_PROCS (built-in processes) is empty for added companies — they configure all
// their processes in the custom process card.
export default function Settings({ user }) {
  const [aiKey, setAiKey]   = useState('');
  const [showKey, setShowKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMsg, setAiMsg]   = useState('');

  const [dstActive, setDstActive] = useState(true);
  const [dstMsg, setDstMsg]       = useState('');

  const [taskCfg, setTaskCfg]     = useState(() => {
    const cfg = {};
    DEF_PROCS.forEach(p => {
      cfg[p] = (DEFAULT_TASKS[p] ?? []).map(t => ({ name: t.name, target: '', weight: '' }));
    });
    return cfg;
  });
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgMsg, setCfgMsg]         = useState('');

  // Custom process task config
  const [customProcs, setCustomProcs]     = useState([]);
  const [customTaskCfg, setCustomTaskCfg] = useState({});
  const [customMsg, setCustomMsg]         = useState('');
  const [taskForm, setTaskForm]           = useState(null);   // Add Task modal { process, name, target, weight, error }
  const [taskSaving, setTaskSaving]       = useState(false);

  useEffect(() => {
    kv.get('anthropic_key').then(k => { if (k) setAiKey(k); });
    kv.get('shift_dst').then(v => setDstActive(v !== false));
    loadTaskCfg();
    loadCustomProcs();
  }, []);

  async function setShiftDst(active) {
    if (active === dstActive) return;
    if (!await confirmDialog({
      title: 'Change shift timing?',
      message: `The shift will start at ${active ? '6:30 PM' : '5:30 PM'} IST for everyone, and the Hourly Tracker slots will move.`,
      confirmText: 'Change Timing',
    })) return;
    setDstActive(active);
    await kv.set('shift_dst', active);
    logAudit({ actor: user, action: 'change_shift_timing', entityType: 'setting', entityId: 'shift_dst', details: { shift_start_ist: active ? '6:30 PM' : '5:30 PM' } });
    setDstMsg(`✓ Shift now starts at ${active ? '6:30 PM' : '5:30 PM'} IST`);
    setTimeout(() => setDstMsg(''), 3000);
  }

  async function loadTaskCfg() {
    setCfgLoading(true);
    const rows = await S.get('task_configs');
    if (rows?.length) {
      const cfg = {};
      DEF_PROCS.forEach(p => {
        cfg[p] = (DEFAULT_TASKS[p] ?? []).map(t => {
          const saved = rows.find(r => r.process === p && r.name === t.name);
          const tgt = saved?.target;
          return {
            name: t.name,
            target: tgt != null ? String(tgt) : '',
            weight: tgt ? String(+(50 / tgt).toFixed(3)) : '',
          };
        });
      });
      setTaskCfg(cfg);
    }
    setCfgLoading(false);
  }

  async function loadCustomProcs() {
    const [procs, rows] = await Promise.all([
      S.get('processes'),
      S.get('task_configs'),
    ]);
    const customs = (procs ?? []).filter(p => !DEF_PROCS.includes(p.name) && p.active !== false);
    setCustomProcs(customs);
    const cfg = {};
    for (const p of customs) {
      cfg[p.name] = (rows ?? [])
        .filter(r => r.process === p.name)
        .map(t => ({
          name: t.name,
          target: String(t.target),
          weight: t.target ? String(+(50 / t.target).toFixed(3)) : '',
        }));
    }
    setCustomTaskCfg(cfg);
  }

  async function saveAiKey() {
    const k = aiKey.trim();
    if (!k) return;
    if (!await confirmDialog({ title: 'Save API key?', message: 'AI email generation will use this key.', confirmText: 'Save Key' })) return;
    setAiSaving(true);
    await kv.set('anthropic_key', k);
    logAudit({ actor: user, action: 'save_ai_key', entityType: 'setting', entityId: 'anthropic_key' });   // never the key itself
    setAiMsg('✓ API key saved to Supabase');
    setAiSaving(false);
    setTimeout(() => setAiMsg(''), 3000);
  }

  async function clearAiKey() {
    if (!await confirmDialog({ title: 'Clear the API key?', message: 'AI email generation will stop working until a key is saved again.', tone: 'danger', confirmText: 'Clear Key' })) return;
    await kv.set('anthropic_key', null);
    logAudit({ actor: user, action: 'clear_ai_key', entityType: 'setting', entityId: 'anthropic_key' });
    setAiKey('');
    setAiMsg('Key cleared.');
    setTimeout(() => setAiMsg(''), 2000);
  }

  function updateTarget(proc, name, value) {
    const tgt = parseFloat(value);
    setTaskCfg(prev => ({
      ...prev,
      [proc]: prev[proc].map(t => t.name === name ? {
        ...t,
        target: value,
        weight: value !== '' && tgt > 0 ? String(+(50 / tgt).toFixed(3)) : '',
      } : t),
    }));
  }

  function updateWeight(proc, name, value) {
    const wt = parseFloat(value);
    setTaskCfg(prev => ({
      ...prev,
      [proc]: prev[proc].map(t => t.name === name ? {
        ...t,
        weight: value,
        target: value !== '' && wt > 0 ? String(Math.round(50 / wt)) : '',
      } : t),
    }));
  }

  async function saveTaskCfg() {
    if (!await confirmDialog({ title: 'Save task targets?', message: 'Productivity for these processes will be calculated with the new targets from now on.', confirmText: 'Save' })) return;
    setCfgMsg('');
    const upserts = [];
    DEF_PROCS.forEach(p => {
      (taskCfg[p] ?? []).forEach(t => {
        if (t.target !== '') {
          upserts.push(
            S.set('task_configs', { process: p, name: t.name, target: parseInt(t.target) || 0 }, ['process', 'name'])
          );
        }
      });
    });
    await Promise.all(upserts);
    logAudit({ actor: user, action: 'save_task_targets', entityType: 'task_config', details: { processes: [...DEF_PROCS] } });
    setCfgMsg('✓ Task targets saved');
    setTimeout(() => setCfgMsg(''), 3000);
  }

  async function resetTaskCfg() {
    if (!await confirmDialog({ title: 'Reset task targets?', message: 'All built-in task targets will go back to their defaults.', tone: 'warning', confirmText: 'Reset' })) return;
    await Promise.all(
      DEF_PROCS.flatMap(p =>
        (DEFAULT_TASKS[p] ?? []).map(t => S.del('task_configs', { process: p, name: t.name }))
      )
    );
    logAudit({ actor: user, action: 'reset_task_targets', entityType: 'task_config', details: { processes: [...DEF_PROCS] } });
    await loadTaskCfg();
  }

  // ── Custom process tasks — one pop-up adds, edits or deletes a task ─────────
  // Target and weight auto-sync (Weight = 50 ÷ Target); changes save immediately.
  const weightOf = tgt => String(+(50 / tgt).toFixed(3));

  function openTaskForm(process) {
    setTaskForm({ process: process ?? customProcs[0]?.name ?? '', name: '', target: '', weight: '', error: '' });
  }

  function openTaskEdit(process, t) {
    setTaskForm({ process, oldName: t.name, name: t.name, target: t.target, weight: t.weight, error: '' });
  }

  function setTaskField(key, value) {
    setTaskForm(f => {
      const n = parseFloat(value);
      const next = { ...f, [key]: value, error: '' };
      if (key === 'target') next.weight = value !== '' && n > 0 ? weightOf(n) : '';
      if (key === 'weight') next.target = value !== '' && n > 0 ? String(Math.round(50 / n)) : '';
      return next;
    });
  }

  async function saveTaskForm() {
    const { process, oldName } = taskForm;
    const editing = oldName != null;
    const name = taskForm.name.trim();
    const target = parseInt(taskForm.target);
    const fail = error => setTaskForm(f => ({ ...f, error }));
    if (!process) return fail('Choose a sub-process.');
    if (!name) return fail('Enter a task name.');
    if (!(target > 0)) return fail('Enter a daily target (or a weight) greater than 0.');
    const renamed = editing && name !== oldName;
    if ((!editing || renamed) && (customTaskCfg[process] ?? []).some(t => t.name.toLowerCase() === name.toLowerCase() && t.name !== oldName)) {
      return fail(`${process} already has a task called “${name}”.`);
    }
    if (!await confirmDialog({
      title: editing ? 'Save task changes?' : 'Add this task?',
      message: `${renamed ? `${oldName} → ` : ''}${name} · ${process}\nDaily target ${target} · weight ${weightOf(target)}×`
        + (renamed ? '\n\nPast reports keep the old task name.' : ''),
      confirmText: editing ? 'Save Changes' : 'Add Task',
    })) return;
    setTaskSaving(true);
    const ok = await S.set('task_configs', { process, name, target }, ['process', 'name']);
    if (ok && renamed) await S.del('task_configs', { process, name: oldName });
    setTaskSaving(false);
    if (!ok) return fail('Could not save the task. Please try again.');
    logAudit({
      actor: user, action: editing ? 'edit_task' : 'add_task', entityType: 'task_config', entityId: `${process} / ${name}`,
      details: { process, task: name, target, ...(renamed ? { previous_name: oldName } : {}) },
    });
    const row = { name, target: String(target), weight: weightOf(target) };
    setCustomTaskCfg(prev => ({
      ...prev,
      [process]: editing
        ? (prev[process] ?? []).map(t => (t.name === oldName ? row : t))
        : [...(prev[process] ?? []), row],
    }));
    setTaskForm(null);
    setCustomMsg(`✓ Task “${name}” ${editing ? 'updated' : `added to ${process}`}`);
    setTimeout(() => setCustomMsg(''), 3000);
  }

  async function deleteTaskForm() {
    const { process, oldName } = taskForm;
    if (!await confirmDialog({ title: 'Delete this task?', message: `“${oldName}” will be removed from ${process}.`, tone: 'danger', confirmText: 'Delete' })) return;
    setTaskSaving(true);
    await S.del('task_configs', { process, name: oldName });
    logAudit({ actor: user, action: 'delete_task', entityType: 'task_config', entityId: `${process} / ${oldName}`, details: { process, task: oldName } });
    setTaskSaving(false);
    setCustomTaskCfg(prev => ({ ...prev, [process]: (prev[process] ?? []).filter(t => t.name !== oldName) }));
    setTaskForm(null);
  }

  const totalWeight = proc => {
    const tasks = taskCfg[proc] ?? [];
    return tasks.reduce((s, t) => s + (parseFloat(t.target) || 0), 0);
  };

  const inputStyle = { width: 72, textAlign: 'right', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 12 };
  const accentInputStyle = { ...inputStyle, border: '1px solid var(--accent)', color: 'var(--accent)', fontWeight: 700 };
  const thStyle = { textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 };
  const thR = { ...thStyle, textAlign: 'right' };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Configure API keys, shift timing, and task productivity targets</div>
        </div>
      </div>

      {/* Anthropic API Key */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Anthropic API Key</div>
          <span className="badge badge-blue">AI Features</span>
        </div>
        <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
          Required for AI email generation (Today, Summary pages). Saved securely to Supabase kv store per admin.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={aiKey}
            onChange={e => setAiKey(e.target.value)}
            placeholder="sk-ant-api03-…"
            style={{ flex: 1, maxWidth: 420 }}
          />
          <button className="btn-sm" onClick={() => setShowKey(v => !v)}>
            {showKey ? 'Hide' : 'Show'}
          </button>
          <button className="btn-primary" onClick={saveAiKey} disabled={aiSaving || !aiKey.trim()}>
            {aiSaving ? 'Saving…' : 'Save Key'}
          </button>
          {aiKey && (
            <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={clearAiKey}>Clear</button>
          )}
        </div>
        {aiMsg && (
          <p className="text-sm" style={{ color: aiMsg.includes('✓') ? 'var(--success)' : 'var(--text-muted)', marginTop: 8 }}>
            {aiMsg}
          </p>
        )}
      </div>

      {/* Shift timing */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Shift Timing</div>
          <span className="badge badge-blue">US Daylight Saving</span>
        </div>
        <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
          The team works a US shift tracked in IST. When the US observes Daylight Saving Time
          (mid-March to early November), the shift's IST-equivalent start time moves 1 hour later.
          Flip this when DST starts/ends — it updates the Hourly Tracker's slot times for everyone.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn-sm"
            onClick={() => setShiftDst(false)}
            style={!dstActive ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
          >
            Standard Time — starts 5:30 PM
          </button>
          <button
            className="btn-sm"
            onClick={() => setShiftDst(true)}
            style={dstActive ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
          >
            Daylight Saving — starts 6:30 PM
          </button>
        </div>
        {dstMsg && <p className="text-sm" style={{ color: 'var(--success)', marginTop: 8 }}>{dstMsg}</p>}
      </div>

      {/* Built-in process task config (home company only) */}
      {DEF_PROCS.length > 0 && <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Task Target Configuration</div>
          <div className="row" style={{ gap: 8 }}>
            {cfgMsg && <span className="text-sm" style={{ color: 'var(--success)' }}>{cfgMsg}</span>}
            <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={resetTaskCfg}>Reset to Defaults</button>
            <button className="btn-primary" onClick={saveTaskCfg}>Save All Task Config</button>
          </div>
        </div>
        <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
          Set target <strong>or</strong> weight per task — they auto-sync. Weight = 50 ÷ Target (the multiplier used in the productivity formula).
        </p>
        {cfgLoading ? (
          <div className="loading-row"><div className="spinner" /> Loading…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 24 }}>
            {DEF_PROCS.map(proc => {
              const configured = (taskCfg[proc] ?? []).filter(t => t.target !== '').length;
              return (
                <div key={proc}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--accent)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{proc} Tasks</span>
                    {configured > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{configured} customised</span>}
                  </div>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Task</th>
                        <th style={thR}>Default</th>
                        <th style={thR}>Target</th>
                        <th style={thR}>Weight ×</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(taskCfg[proc] ?? []).map(t => {
                        const defTgt = DEFAULT_TASKS[proc]?.find(d => d.name === t.name)?.target ?? '—';
                        return (
                          <tr key={t.name}>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{t.name}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{defTgt}</td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                              <input type="number" min="1" value={t.target} onChange={e => updateTarget(proc, t.name, e.target.value)} placeholder={String(defTgt)} style={inputStyle} />
                            </td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                              <input type="number" min="0.001" step="0.001" value={t.weight} onChange={e => updateWeight(proc, t.name, e.target.value)} placeholder={defTgt !== '—' ? String(+(50 / defTgt).toFixed(3)) : '—'} style={accentInputStyle} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>}

      {/* Custom process task config — every process for added companies */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">{DEF_PROCS.length ? 'Custom Process Task Configuration' : 'Productivity Tasks & Weightage'}</div>
          <div className="row" style={{ gap: 8 }}>
            {customMsg && <span className="text-sm" style={{ color: 'var(--success)' }}>{customMsg}</span>}
            {customProcs.length > 0 && (
              <button className="btn-primary" onClick={() => openTaskForm()}>+ Add Task</button>
            )}
          </div>
        </div>

        {customProcs.length === 0 ? (
          <p className="text-muted text-sm">
            No {DEF_PROCS.length ? 'custom ' : ''}processes yet. Go to <strong>Team → + Add Project</strong> to create a project and its sub-processes, then come back here and click <strong>+ Add Task</strong> to define each one's tasks, targets and weightage.
            Employee IDs are created in <strong>Team → + Add User</strong>.
          </p>
        ) : (
          <>
            <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
              Click <strong>+ Add Task</strong> to add a task, or click a task to edit or delete it. <strong>Weight = 50 ÷ Target.</strong>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 24 }}>
              {customProcs.map(proc => {
                const tasks = customTaskCfg[proc.name] ?? [];
                const td = { padding: '8px', borderBottom: '1px solid var(--border)' };
                return (
                  <div key={proc.name}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{proc.name} Tasks</span>
                      <span className="badge badge-yellow" style={{ fontWeight: 400, fontSize: 10 }}>{proc.project}</span>
                    </div>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Task</th>
                          <th style={thR}>Target</th>
                          <th style={thR}>Weight ×</th>
                          <th style={thR}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.length === 0 && (
                          <tr>
                            <td colSpan={4} style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                              No tasks yet — click + Add Task
                            </td>
                          </tr>
                        )}
                        {tasks.map(t => (
                          <tr key={t.name} onClick={() => openTaskEdit(proc.name, t)} style={{ cursor: 'pointer' }} title="Edit or delete this task">
                            <td style={{ ...td, color: 'var(--text)' }}>{t.name}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{t.target || '—'}</td>
                            <td style={{ ...td, textAlign: 'right', color: 'var(--accent)', fontWeight: 700 }}>{t.weight || '—'}</td>
                            <td style={{ ...td, textAlign: 'right' }}>
                              <button type="button" className="btn-sm" onClick={e => { e.stopPropagation(); openTaskEdit(proc.name, t); }}>Edit</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button className="btn-sm" onClick={() => openTaskForm(proc.name)}>+ Add Task to {proc.name}</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Add / edit task modal */}
      {taskForm && (
        <Modal title={taskForm.oldName != null ? `Edit Task — ${taskForm.oldName}` : 'Add Productivity Task'} onClose={() => setTaskForm(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label>Sub-process</label>
              <select value={taskForm.process} disabled={taskForm.oldName != null} onChange={e => setTaskField('process', e.target.value)}>
                {[...new Set(customProcs.map(p => p.project))].map(proj => (
                  <optgroup key={proj} label={proj}>
                    {customProcs.filter(p => p.project === proj).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Task name</label>
              <input type="text" value={taskForm.name} autoFocus placeholder="e.g. Claim Review"
                onChange={e => setTaskField('name', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Daily target</label>
                <input type="number" min="1" value={taskForm.target} placeholder="e.g. 50"
                  onChange={e => setTaskField('target', e.target.value)} />
              </div>
              <div className="field">
                <label>Weight ×</label>
                <input type="number" min="0.001" step="0.001" value={taskForm.weight} placeholder="e.g. 1"
                  onChange={e => setTaskField('weight', e.target.value)} />
              </div>
            </div>
            <p className="text-sm text-muted">
              Fill in either one — the other is calculated. Weight = 50 ÷ Target, so a task with target 50 counts 1× per item
              and a task with target 25 counts 2×.
            </p>
            {taskForm.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{taskForm.error}</p>}
            <div className="form-actions" style={taskForm.oldName != null ? { justifyContent: 'space-between' } : undefined}>
              {taskForm.oldName != null && (
                <button className="btn-danger" onClick={deleteTaskForm} disabled={taskSaving}>Delete Task</button>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-sm" onClick={() => setTaskForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveTaskForm} disabled={taskSaving}>
                  {taskSaving ? 'Saving…' : taskForm.oldName != null ? 'Save Changes' : 'Add Task'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
