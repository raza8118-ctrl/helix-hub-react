import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { addDays, today, fmtSh, avg, pCol } from '../../lib/helpers';
import { DEFAULT_TASKS } from '../../lib/constants';
import BarChart from './BarChart';
import { KPI, H2, Btn, SectionLabel } from './UI';

function pColor(p) {
  if (p == null) return 'var(--col-neutral)';
  if (p >= 100) return 'var(--col-green)';
  if (p >= 85)  return 'var(--col-yellow)';
  if (p >= 70)  return 'var(--col-orange)';
  return 'var(--col-red)';
}

export default function EmpDetail({ emp, onClose, currentUser }) {
  const [logs, setLogs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]       = useState('');

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => { loadLogs(); }, [emp.emp_id]);

  async function loadLogs() {
    setLoading(true);
    const cutoff = addDays(today(), -30);
    const l = await S.get('daily_logs', { emp_id: emp.emp_id });
    const filtered = (l || [])
      .filter(r => r.date >= cutoff)
      .sort((a, b) => (a.date > b.date ? 1 : -1));
    setLogs(filtered);
    setLoading(false);
  }

  function prodOf(l) {
    const t = l.adj_target ?? l.target;
    if (!t || l.total == null) return null;
    return Math.round((l.total / t) * 100);
  }

  // KPI calculations
  const prods = logs.map(prodOf).filter(v => v != null);
  const avgProdVal = avg(prods);
  const daysAbove  = prods.filter(p => p >= 100).length;
  const daysBelow  = prods.filter(p => p < 75).length;
  const totalClaims = logs.reduce((s, l) => s + (l.total || 0), 0);
  const avgQual    = avg(logs.map(l => l.quality).filter(v => v != null));

  // Bar chart: last 14 days
  const chartData = logs.slice(-14).map(l => ({
    name: fmtSh(l.date),
    prod: prodOf(l) ?? 0,
  }));

  // Task breakdown: last 7 days
  const last7 = logs.slice(-7);
  const proc = emp.process || emp.access || 'MCO';
  const taskDefs = DEFAULT_TASKS[proc] || DEFAULT_TASKS.MCO;

  const initials = (emp.name || emp.emp_id || '?')
    .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

  async function doAction(confirmMsg, fn) {
    if (!window.confirm(confirmMsg)) return;
    setMsg('');
    try {
      await fn();
      setMsg('Done.');
      loadLogs();
    } catch {
      setMsg('Action failed.');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box fade-in-scale"
        style={{ maxWidth: 760, width: '95vw' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          {emp.avatar_url ? (
            <img src={emp.avatar_url} alt="" style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 54, height: 54, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #7c3aed, #4338ca)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, color: '#fff',
            }}>
              {initials}
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{emp.name || emp.emp_id}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span>{emp.emp_id}</span>
              <span>·</span>
              <span>{proc}</span>
              <span>·</span>
              <span style={{ textTransform: 'capitalize' }}>{emp.role}</span>
              {emp.target && <><span>·</span><span>Target {emp.target}</span></>}
              {emp.created_at && (
                <><span>·</span>
                <span>Joined {new Date(emp.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span></>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Scrollable body */}
        <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
          {loading ? (
            <div className="loading-row"><div className="spinner" /> Loading data…</div>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid-4" style={{ marginBottom: 20 }}>
                <KPI
                  label="Avg Productivity"
                  value={avgProdVal != null ? avgProdVal.toFixed(1) + '%' : '—'}
                  color={pColor(avgProdVal)}
                  sub="last 30 days"
                />
                <KPI label="Days ≥ 100%" value={daysAbove} color="var(--col-green)" sub="on target" />
                <KPI label="Days < 75%"  value={daysBelow} color="var(--col-red)"   sub="below threshold" />
                <KPI
                  label="Avg Quality"
                  value={avgQual != null ? avgQual.toFixed(1) + '%' : '—'}
                  color="var(--accent)"
                  sub="quality score"
                />
              </div>

              {/* Bar chart */}
              <H2 icon="📊">Last 14 Days — Productivity</H2>
              {chartData.length ? (
                <BarChart data={chartData} height={160} />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>No chart data.</div>
              )}

              {/* Task breakdown */}
              <H2 icon="📋" style={{ marginTop: 22 }}>Last 7 Days — Task Breakdown</H2>
              {last7.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>No data for this period.</div>
              ) : (
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                        <th style={{ textAlign: 'right' }}>Target</th>
                        <th style={{ textAlign: 'right' }}>Prod%</th>
                        {taskDefs.map(t => (
                          <th key={t.name} style={{ textAlign: 'right' }}>{t.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {last7.map(l => {
                        const adjT = l.adj_target ?? l.target;
                        const prod = prodOf(l);
                        const tasks = l.tasks || {};
                        return (
                          <tr key={l.date}>
                            <td>{fmtSh(l.date)}</td>
                            <td style={{ textAlign: 'right' }}>{l.total ?? '—'}</td>
                            <td style={{ textAlign: 'right' }}>{adjT ?? '—'}</td>
                            <td className={pCol(prod)} style={{ textAlign: 'right' }}>
                              {prod != null ? prod + '%' : '—'}
                            </td>
                            {taskDefs.map(t => (
                              <td key={t.name} style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                {tasks[t.name] ?? '—'}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Admin controls */}
              {isAdmin && (
                <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                  <SectionLabel>Admin Controls</SectionLabel>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Btn variant="danger" onClick={() => doAction(
                      `Delete ALL productivity reports for ${emp.name || emp.emp_id}? This cannot be undone.`,
                      () => S.del('daily_logs', { emp_id: emp.emp_id })
                    )}>
                      Delete Prod Reports
                    </Btn>
                    <Btn variant="danger" onClick={() => doAction(
                      `Clear all feedback entries for ${emp.name || emp.emp_id}?`,
                      () => S.del('feedback', { emp_id: emp.emp_id })
                    )}>
                      Clear Feedback
                    </Btn>
                    <Btn variant="amber" onClick={() => doAction(
                      `Clear hourly tracker data for ${emp.name || emp.emp_id}?`,
                      () => S.del('hourly_logs', { emp_id: emp.emp_id })
                    )}>
                      Clear Hourly Tracker
                    </Btn>
                    <Btn variant="amber" onClick={() => doAction(
                      `Clear call tracker data for ${emp.name || emp.emp_id}?`,
                      () => S.del('call_logs', { emp_id: emp.emp_id })
                    )}>
                      Clear Call Tracker
                    </Btn>
                  </div>
                  {msg && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>{msg}</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
