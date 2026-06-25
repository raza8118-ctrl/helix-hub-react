import { useState, useEffect } from 'react';
import { kv, S } from '../../lib/supabase';
import { DEFAULT_TASKS, DEF_PROCS } from '../../lib/constants';
import Changelog from './Changelog';

const PROCESSES = ['MCO', 'MCD', 'MCR', 'AUTH'];

export default function Settings({ user }) {
  const [aiKey, setAiKey]   = useState('');
  const [showKey, setShowKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMsg, setAiMsg]   = useState('');

  const [dstActive, setDstActive] = useState(true);
  const [dstMsg, setDstMsg]       = useState('');

  const [taskCfg, setTaskCfg]     = useState(() => {
    const cfg = {};
    PROCESSES.forEach(p => {
      cfg[p] = (DEFAULT_TASKS[p] ?? []).map(t => ({ name: t.name, target: '', weight: '' }));
    });
    return cfg;
  });
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgMsg, setCfgMsg]         = useState('');

  // Custom process task config
  const [customProcs, setCustomProcs]     = useState([]);
  const [customTaskCfg, setCustomTaskCfg] = useState({});
  const [newTaskNames, setNewTaskNames]   = useState({});
  const [customMsg, setCustomMsg]         = useState('');
  const [customSaving, setCustomSaving]   = useState(false);

  useEffect(() => {
    kv.get('anthropic_key').then(k => { if (k) setAiKey(k); });
    kv.get('shift_dst').then(v => setDstActive(v !== false));
    loadTaskCfg();
    loadCustomProcs();
  }, []);

  async function setShiftDst(active) {
    setDstActive(active);
    await kv.set('shift_dst', active);
    setDstMsg(`✓ Shift now starts at ${active ? '6:30 PM' : '5:30 PM'} IST`);
    setTimeout(() => setDstMsg(''), 3000);
  }

  async function loadTaskCfg() {
    setCfgLoading(true);
    const rows = await S.get('task_configs');
    if (rows?.length) {
      const cfg = {};
      PROCESSES.forEach(p => {
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
    const names = {};
    for (const p of customs) {
      cfg[p.name] = (rows ?? [])
        .filter(r => r.process === p.name)
        .map(t => ({
          name: t.name,
          target: String(t.target),
          weight: t.target ? String(+(50 / t.target).toFixed(3)) : '',
        }));
      names[p.name] = '';
    }
    setCustomTaskCfg(cfg);
    setNewTaskNames(names);
  }

  async function saveAiKey() {
    const k = aiKey.trim();
    if (!k) return;
    setAiSaving(true);
    await kv.set('anthropic_key', k);
    setAiMsg('✓ API key saved to Supabase');
    setAiSaving(false);
    setTimeout(() => setAiMsg(''), 3000);
  }

  async function clearAiKey() {
    await kv.set('anthropic_key', null);
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
    setCfgMsg('');
    const upserts = [];
    PROCESSES.forEach(p => {
      (taskCfg[p] ?? []).forEach(t => {
        if (t.target !== '') {
          upserts.push(
            S.set('task_configs', { process: p, name: t.name, target: parseInt(t.target) || 0 }, ['process', 'name'])
          );
        }
      });
    });
    await Promise.all(upserts);
    setCfgMsg('✓ Task targets saved');
    setTimeout(() => setCfgMsg(''), 3000);
  }

  async function resetTaskCfg() {
    if (!window.confirm('Reset all task targets to defaults?')) return;
    await Promise.all(
      PROCESSES.flatMap(p =>
        (DEFAULT_TASKS[p] ?? []).map(t => S.del('task_configs', { process: p, name: t.name }))
      )
    );
    await loadTaskCfg();
  }

  // ── Custom process task helpers ────────────────────────────────────────────

  function updateCustomTarget(proc, taskName, value) {
    const tgt = parseFloat(value);
    setCustomTaskCfg(prev => ({
      ...prev,
      [proc]: (prev[proc] ?? []).map(t => t.name === taskName ? {
        ...t,
        target: value,
        weight: value !== '' && tgt > 0 ? String(+(50 / tgt).toFixed(3)) : '',
      } : t),
    }));
  }

  function addCustomTask(proc) {
    const name = (newTaskNames[proc] ?? '').trim();
    if (!name) return;
    if ((customTaskCfg[proc] ?? []).some(t => t.name === name)) return;
    setCustomTaskCfg(prev => ({
      ...prev,
      [proc]: [...(prev[proc] ?? []), { name, target: '', weight: '' }],
    }));
    setNewTaskNames(prev => ({ ...prev, [proc]: '' }));
  }

  async function removeCustomTask(proc, taskName) {
    await S.del('task_configs', { process: proc, name: taskName });
    setCustomTaskCfg(prev => ({
      ...prev,
      [proc]: (prev[proc] ?? []).filter(t => t.name !== taskName),
    }));
  }

  async function saveCustomTaskCfg() {
    setCustomSaving(true);
    setCustomMsg('');
    const upserts = [];
    Object.entries(customTaskCfg).forEach(([proc, tasks]) => {
      tasks.forEach(t => {
        if (t.target !== '') {
          upserts.push(
            S.set('task_configs', { process: proc, name: t.name, target: parseInt(t.target) || 0 }, ['process', 'name'])
          );
        }
      });
    });
    await Promise.all(upserts);
    setCustomMsg('✓ Custom process targets saved');
    setCustomSaving(false);
    setTimeout(() => setCustomMsg(''), 3000);
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

      {/* Built-in process task config */}
      <div className="card mb-16">
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
            {PROCESSES.map(proc => {
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
      </div>

      {/* Custom process task config */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Custom Process Task Configuration</div>
          <div className="row" style={{ gap: 8 }}>
            {customMsg && <span className="text-sm" style={{ color: 'var(--success)' }}>{customMsg}</span>}
            {customProcs.length > 0 && (
              <button className="btn-primary" onClick={saveCustomTaskCfg} disabled={customSaving}>
                {customSaving ? 'Saving…' : 'Save Custom Config'}
              </button>
            )}
          </div>
        </div>

        {customProcs.length === 0 ? (
          <p className="text-muted text-sm">
            No custom processes yet. Go to <strong>Team → Process / Project Management</strong> to create a new process group and sub-process, then come back here to define its tasks and targets.
          </p>
        ) : (
          <>
            <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
              Define tasks and daily targets for each custom process. These feed into the productivity formula the same way as built-in process tasks. <strong>Weight = 50 ÷ Target.</strong>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 24 }}>
              {customProcs.map(proc => {
                const tasks = customTaskCfg[proc.name] ?? [];
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
                          <th style={{ padding: '7px 8px', borderBottom: '1px solid var(--border)' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.length === 0 && (
                          <tr>
                            <td colSpan={4} style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                              No tasks yet — add one below
                            </td>
                          </tr>
                        )}
                        {tasks.map(t => (
                          <tr key={t.name}>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{t.name}</td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                              <input
                                type="number" min="1"
                                value={t.target}
                                onChange={e => updateCustomTarget(proc.name, t.name, e.target.value)}
                                placeholder="—"
                                style={inputStyle}
                              />
                            </td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                              <input
                                type="number" readOnly
                                value={t.weight}
                                placeholder="—"
                                style={accentInputStyle}
                              />
                            </td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => removeCustomTask(proc.name, t.name)}
                                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                                title="Remove task"
                              >✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        type="text"
                        placeholder="New task name…"
                        value={newTaskNames[proc.name] ?? ''}
                        onChange={e => setNewTaskNames(prev => ({ ...prev, [proc.name]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && addCustomTask(proc.name)}
                        style={{ flex: 1, fontSize: 12 }}
                      />
                      <button className="btn-sm" onClick={() => addCustomTask(proc.name)}>+ Add Task</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="mt-4">
        <Changelog />
      </div>
    </div>
  );
}
