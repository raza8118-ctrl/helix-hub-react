import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { today, fmtD, pCol, dlCSV } from '../../lib/helpers';
import { DEFAULT_TASKS, AUTH_HOURLY_TASKS, HOURLY_SLOTS, SHIFT_H } from '../../lib/constants';

const initSlots = () => HOURLY_SLOTS.map(s => ({ slot: s, task: AUTH_HOURLY_TASKS[0], count: '' }));

export default function ProdReport({ user }) {
  const isAuth = user.access === 'AUTH';
  const proc   = isAuth ? 'AUTH' : (user.access || 'MCO');
  const taskDefs = DEFAULT_TASKS[proc] ?? [];

  const [date, setDate]       = useState(today());
  const [holiday, setHoliday] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  // AUTH hourly slots
  const [slots, setSlots] = useState(initSlots);

  // Non-AUTH task counts { taskName: count }
  const [taskCounts, setTaskCounts] = useState({});

  // Common fields
  const [downtime, setDowntime]         = useState('');
  const [remarks, setRemarks]           = useState('');
  const [quality, setQuality]           = useState(isAuth ? '100' : '');
  const [qualityNA, setQualityNA]       = useState(false);
  const [qualityDate, setQualityDate]   = useState(today());
  const [calls, setCalls]               = useState('');
  const [callHours, setCallHours]       = useState('');
  const [insuranceCall, setInsuranceCall] = useState('');
  const [callNotes, setCallNotes]       = useState('');

  useEffect(() => { load(); }, [date]);

  async function load() {
    setLoading(true); setSaved(false);
    const [logs, hols] = await Promise.all([
      S.get('daily_logs', { emp_id: user.emp_id, date }),
      S.get('holidays', { date }),
    ]);
    const ex = logs?.[0] ?? null;
    setHoliday(hols?.[0] ?? null);

    if (ex) {
      setDowntime(ex.downtime != null ? String(ex.downtime) : '');
      setRemarks(ex.remarks ?? '');
      setCalls(ex.calls != null ? String(ex.calls) : '');
      setCallHours(ex.call_hours != null ? String(ex.call_hours) : '');
      setInsuranceCall(ex.insurance_call ?? '');
      setCallNotes(ex.call_notes ?? '');
      if (!isAuth) {
        setTaskCounts(ex.tasks ?? {});
        setQuality(ex.quality != null ? String(ex.quality) : '');
        setQualityNA(ex.quality == null);
      }
      if (isAuth) {
        const hRows = await S.get('hourly_logs', { emp_id: user.emp_id, date });
        const hr = hRows?.[0];
        if (hr) {
          setSlots(prev => prev.map((s, i) => ({
            ...s,
            count: hr[`h${i}`] != null ? String(hr[`h${i}`]) : '',
          })));
        }
      }
    } else {
      setSlots(initSlots());
      setTaskCounts({});
      setDowntime(''); setRemarks('');
      setQuality(isAuth ? '100' : ''); setQualityNA(false);
      setCalls(''); setCallHours(''); setInsuranceCall(''); setCallNotes('');
    }
    setLoading(false);
  }

  // ── Live calculations ─────────────────────────────────────────────────────
  const authTotal    = slots.reduce((s, sl) => s + (parseInt(sl.count) || 0), 0);
  const nonAuthTotal = taskDefs.reduce((s, t) => s + (parseInt(taskCounts[t.name]) || 0), 0);
  const total        = isAuth ? authTotal : nonAuthTotal;

  const dailyTarget = parseInt(user.target) || taskDefs.reduce((s, t) => s + t.target, 0) || 100;
  const dt          = parseFloat(downtime) || 0;
  const adjTarget   = isAuth ? null : Math.max(0, Math.round(dailyTarget * ((SHIFT_H - dt) / SHIFT_H)));
  const prodPct     = adjTarget > 0 ? Math.round((total / adjTarget) * 100) : null;
  const deficit     = adjTarget != null ? Math.max(0, adjTarget - total) : 0;

  // AUTH: aggregate slot counts by task type
  const authSummary = AUTH_HOURLY_TASKS.map(task => ({
    task,
    count: slots.filter(s => s.task === task).reduce((s, sl) => s + (parseInt(sl.count) || 0), 0),
  }));

  function updateSlot(i, field, value) {
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save() {
    setSaving(true);
    const tasks = isAuth
      ? Object.fromEntries(authSummary.map(t => [t.task, t.count]))
      : { ...taskCounts };

    const payload = {
      emp_id: user.emp_id,
      emp_name: user.name ?? user.emp_id,
      date, process: proc,
      total,
      target: isAuth ? null : dailyTarget,
      adj_target: isAuth ? null : adjTarget,
      downtime: dt || null,
      quality: (isAuth || qualityNA) ? null : (parseFloat(quality) || null),
      tasks,
      remarks: remarks.trim() || null,
      calls: parseInt(calls) || null,
      call_hours: parseFloat(callHours) || null,
      insurance_call: insuranceCall.trim() || null,
      call_notes: callNotes.trim() || null,
      submitted: true,
      submitted_at: new Date().toISOString(),
    };

    const existing = (await S.get('daily_logs', { emp_id: user.emp_id, date }))?.[0];
    if (existing?.id) {
      await S.update('daily_logs', payload, { id: existing.id });
    } else {
      await S.set('daily_logs', payload);
    }

    if (isAuth) {
      const hPayload = { emp_id: user.emp_id, date };
      slots.forEach((sl, i) => { hPayload[`h${i}`] = parseInt(sl.count) || 0; });
      const exHr = (await S.get('hourly_logs', { emp_id: user.emp_id, date }))?.[0];
      if (exHr?.id) {
        await S.update('hourly_logs', hPayload, { id: exHr.id });
      } else {
        await S.set('hourly_logs', hPayload);
      }
    }

    setSaved(true); setSaving(false);
    await load();
  }

  function exportReport() {
    const headers = ['Date', 'Process', 'Total', 'Target', 'Adj Target', 'Prod%', 'Deficit', 'Downtime', 'Quality', 'Remarks', 'Calls', 'Call Hours'];
    const rows = [{
      Date: date, Process: proc, Total: total,
      Target: isAuth ? 'N/A' : dailyTarget,
      'Adj Target': isAuth ? 'N/A' : adjTarget,
      'Prod%': prodPct != null ? prodPct + '%' : 'N/A',
      Deficit: isAuth ? 'N/A' : deficit,
      Downtime: dt || 0, Quality: qualityNA ? 'N/A' : (quality || '—'),
      Remarks: remarks,
      Calls: calls || 0, 'Call Hours': callHours || 0,
    }];
    dlCSV(headers, rows, `report-${user.emp_id}-${date}.csv`);
  }

  const headerBg = { background: 'linear-gradient(135deg, #1a1d27 0%, #0f1117 100%)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: 20, border: '1px solid #2d3148' };

  return (
    <div>
      {/* Header controls */}
      <div className="page-header">
        <div>
          <div className="page-title">Daily Report</div>
          <div className="page-subtitle">{user.name ?? user.emp_id} · {proc}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 160 }} />
          <button className="btn-sm" onClick={exportReport}>Export CSV</button>
          <button className="btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Report'}
          </button>
        </div>
      </div>

      {/* Holiday banner */}
      {holiday && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--warning)' }}>
          🏖 <strong>{holiday.note}</strong> — Holiday
        </div>
      )}

      {/* Dark KPI header */}
      <div style={headerBg}>
        <div style={{ display: 'grid', gridTemplateColumns: isAuth ? '1fr 1fr' : 'repeat(4,1fr)', gap: 16 }}>
          {[
            { label: 'Total', value: total.toLocaleString(), color: '#e2e8f0' },
            ...(isAuth ? [] : [
              { label: 'Adj.Target', value: adjTarget?.toLocaleString() ?? '—', color: '#94a3b8' },
              { label: 'Prod%', value: prodPct != null ? prodPct + '%' : '—', color: prodPct != null ? (prodPct >= 100 ? '#10b981' : prodPct >= 85 ? '#f59e0b' : '#ef4444') : '#94a3b8' },
              { label: 'Deficit', value: deficit > 0 ? deficit.toLocaleString() : '0', color: deficit > 0 ? '#ef4444' : '#10b981' },
            ]),
            { label: 'Date', value: fmtD(date), color: '#94a3b8' },
          ].map(k => (
            <div key={k.label}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
            </div>
          ))}
        </div>
        {!isAuth && adjTarget != null && dt > 0 && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#64748b' }}>
            Formula: {dailyTarget} × ({SHIFT_H}h − {dt}h) / {SHIFT_H}h = <strong style={{ color: '#94a3b8' }}>{adjTarget}</strong>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-row"><div className="spinner" /> Loading…</div>
      ) : (
        <>
          {/* ── AUTH: Hourly tracker ── */}
          {isAuth && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div className="card-title">Hourly Tracker</div>
                <span className="text-sm text-muted">Total: <strong>{authTotal}</strong></span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 90 }}>Time Slot</th>
                      <th style={{ minWidth: 220 }}>Task</th>
                      <th style={{ minWidth: 100 }}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((sl, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12 }}>{sl.slot}</td>
                        <td>
                          <select value={sl.task} onChange={e => updateSlot(i, 'task', e.target.value)}
                            style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)' }}>
                            {AUTH_HOURLY_TASKS.map(t => <option key={t}>{t}</option>)}
                          </select>
                        </td>
                        <td>
                          <input type="number" min="0" value={sl.count}
                            onChange={e => updateSlot(i, 'count', e.target.value)}
                            style={{ width: 80, padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', textAlign: 'right' }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* AUTH task summary */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div className="section-title" style={{ marginBottom: 10 }}>Task Summary</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 8 }}>
                  {authSummary.filter(t => t.count > 0).map(t => (
                    <div key={t.task} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 13 }}>
                      <span className="text-muted">{t.task}</span>
                      <span className="bold" style={{ color: 'var(--accent)' }}>{t.count}</span>
                    </div>
                  ))}
                  {authSummary.every(t => t.count === 0) && (
                    <div className="text-muted text-sm" style={{ gridColumn: '1/-1', padding: '8px 0' }}>No counts entered yet</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Non-AUTH: Task entry table ── */}
          {!isAuth && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div className="card-title">Task Entry — {proc}</div>
                <span className="text-sm text-muted">Total: <strong>{nonAuthTotal}</strong></span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th className="right" style={{ minWidth: 100 }}>Count</th>
                      <th className="right" style={{ minWidth: 80 }}>Target</th>
                      <th className="right" style={{ minWidth: 80 }}>Fulfilled</th>
                      <th style={{ minWidth: 160 }}>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskDefs.map(t => {
                      const cnt = parseInt(taskCounts[t.name]) || 0;
                      const pct = t.target > 0 ? Math.min(Math.round((cnt / t.target) * 100), 100) : 0;
                      return (
                        <tr key={t.name}>
                          <td className="bold">{t.name}</td>
                          <td className="right">
                            <input
                              type="number" min="0"
                              value={taskCounts[t.name] ?? ''}
                              onChange={e => setTaskCounts(prev => ({ ...prev, [t.name]: e.target.value }))}
                              style={{ width: 80, padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', textAlign: 'right' }}
                            />
                          </td>
                          <td className="right text-muted">{t.target}</td>
                          <td className={`right bold`} style={{ color: pct >= 100 ? 'var(--col-green)' : pct >= 75 ? 'var(--col-yellow)' : 'var(--col-red)' }}>
                            {pct}%
                          </td>
                          <td>
                            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--col-green)' : pct >= 75 ? 'var(--col-yellow)' : 'var(--col-red)', borderRadius: 3, transition: 'width 0.3s ease' }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                      <td style={{ padding: '8px 14px' }}>Total</td>
                      <td className="right" style={{ padding: '8px 14px' }}>{nonAuthTotal}</td>
                      <td className="right" style={{ padding: '8px 14px' }}>{dailyTarget}</td>
                      <td className={`right bold ${pCol(prodPct)}`} style={{ padding: '8px 14px' }}>{prodPct != null ? prodPct + '%' : '—'}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── Downtime (non-AUTH) ── */}
          {!isAuth && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header"><div className="card-title">Downtime</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div className="field" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Downtime (hours)</label>
                  <input type="number" min="0" max={SHIFT_H} step="0.5" value={downtime}
                    onChange={e => setDowntime(e.target.value)}
                    style={{ width: 80, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                  />
                </div>
                {dt > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '6px 14px', borderRadius: 6 }}>
                    Adj. Target: {dailyTarget} × ({SHIFT_H} − {dt}) / {SHIFT_H} = <strong style={{ color: 'var(--accent)' }}>{adjTarget}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Remarks ── */}
          <div className="card" style={{ marginBottom: 16, border: deficit > 0 && !isAuth ? '1px solid rgba(245,158,11,0.5)' : undefined, background: deficit > 0 && !isAuth ? 'rgba(245,158,11,0.04)' : undefined }}>
            <div className="card-header">
              <div className="card-title">Remarks</div>
              {deficit > 0 && !isAuth && <span className="badge badge-yellow">Deficit: {deficit}</span>}
            </div>
            <textarea
              rows={3}
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder={deficit > 0 ? 'Please explain why you are below target…' : 'Optional remarks, notes, or highlights…'}
              style={{ width: '100%', padding: '8px 12px', border: `1px solid ${deficit > 0 && !isAuth ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`, borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>

          {/* ── Quality ── */}
          {!isAuth && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header"><div className="card-title">Quality Score</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" id="qa-na" checked={qualityNA} onChange={e => setQualityNA(e.target.checked)} style={{ width: 'auto' }} />
                  <label htmlFor="qa-na" style={{ marginBottom: 0, cursor: 'pointer', color: 'var(--text)' }}>N/A (no quality review today)</label>
                </div>
                {!qualityNA && (
                  <>
                    <div className="field" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <label style={{ marginBottom: 0 }}>Quality %</label>
                      <input type="number" min="0" max="100" step="0.1" value={quality}
                        onChange={e => setQuality(e.target.value)}
                        style={{ width: 80, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <label style={{ marginBottom: 0 }}>Review Date</label>
                      <input type="date" value={qualityDate} onChange={e => setQualityDate(e.target.value)}
                        style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Call Tracker ── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><div className="card-title">Call Tracker</div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 14 }}>
              {[
                { label: 'Total Calls', value: calls, set: setCalls, type: 'number', placeholder: '0' },
                { label: 'Call Hours', value: callHours, set: setCallHours, type: 'number', placeholder: '0.0' },
                { label: 'Insurance Calls', value: insuranceCall, set: setInsuranceCall, type: 'text', placeholder: 'e.g. Aetna, BCBS' },
              ].map(f => (
                <div key={f.label} className="field" style={{ marginBottom: 0 }}>
                  <label>{f.label}</label>
                  <input type={f.type} value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                    style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, width: '100%', outline: 'none' }}
                  />
                </div>
              ))}
              <div className="field" style={{ marginBottom: 0, gridColumn: '1/-1' }}>
                <label>Call Notes</label>
                <input type="text" value={callNotes} onChange={e => setCallNotes(e.target.value)}
                  placeholder="e.g. Spoke with payer, updated auth status…"
                  style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, width: '100%', outline: 'none' }}
                />
              </div>
            </div>
          </div>

          {/* Save / Export */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button className="btn-sm" onClick={exportReport}>Export CSV</button>
            <button className="btn-primary" onClick={save} disabled={saving || loading} style={{ padding: '9px 24px', fontSize: 14 }}>
              {saving ? 'Saving…' : saved ? '✓ Report Saved' : 'Save Report'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
