import { useState, useEffect } from 'react';
import { kv, S } from '../../lib/supabase';
import { DEFAULT_TASKS } from '../../lib/constants';
import Changelog from './Changelog';

const PROCESSES = ['MCO', 'MCD', 'MCR', 'AUTH'];

export default function Settings({ user }) {
  const [aiKey, setAiKey]   = useState('');
  const [showKey, setShowKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMsg, setAiMsg]   = useState('');

  const [taskCfg, setTaskCfg]     = useState(() => {
    const cfg = {};
    PROCESSES.forEach(p => {
      cfg[p] = (DEFAULT_TASKS[p] ?? []).map(t => ({ name: t.name, target: '', weight: '' }));
    });
    return cfg;
  });
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgMsg, setCfgMsg]         = useState('');

  useEffect(() => {
    // Load saved AI key from kv store
    kv.get('anthropic_key').then(k => { if (k) setAiKey(k); });
    loadTaskCfg();
  }, []);

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

  const totalWeight = proc => {
    const tasks = taskCfg[proc] ?? [];
    const total = tasks.reduce((s, t) => s + (parseFloat(t.target) || 0), 0);
    return total;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Configure API keys and task productivity targets</div>
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

      {/* Task config tables */}
      <div className="card">
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
                        <th style={{ textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Task</th>
                        <th style={{ textAlign: 'right', padding: '7px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Default</th>
                        <th style={{ textAlign: 'right', padding: '7px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Target</th>
                        <th style={{ textAlign: 'right', padding: '7px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Weight ×</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(taskCfg[proc] ?? []).map(t => {
                        const defTgt = DEFAULT_TASKS[proc]?.find(d => d.name === t.name)?.target ?? '—';
                        return (
                          <tr key={t.name}>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                              {t.name}
                            </td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>
                              {defTgt}
                            </td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                              <input
                                type="number"
                                min="1"
                                value={t.target}
                                onChange={e => updateTarget(proc, t.name, e.target.value)}
                                placeholder={String(defTgt)}
                                style={{ width: 72, textAlign: 'right', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
                              />
                            </td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                              <input
                                type="number"
                                min="0.001"
                                step="0.001"
                                value={t.weight}
                                onChange={e => updateWeight(proc, t.name, e.target.value)}
                                placeholder={defTgt !== '—' ? String(+(50 / defTgt).toFixed(3)) : '—'}
                                style={{ width: 72, textAlign: 'right', padding: '4px 8px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface)', color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}
                              />
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

      <div className="mt-4">
        <Changelog />
      </div>
    </div>
  );
}
