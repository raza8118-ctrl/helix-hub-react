import { useState, useMemo } from 'react';
import {
  BANDS, ITEM_STATUSES, DEFAULT_WEIGHTS, itemStatusOf, isDone, prioritise, planSplit, assignItems, saveWorklistSettings,
  closeAndClear,
} from '../../lib/worklist';
import { today } from '../../lib/helpers';
import { fmtUS } from '../../lib/deadlines';
import { confirmDialog } from '../../components/shared/Dialog';

const cell = { padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const usd = n => (n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const PAGE = 200;

/** One worklist for managers (roadmap 6.4): priorities, assign / auto-split, progress per person, Excel, close & clear. */
export default function WorklistManage({ worklist, items, people, ctx, user, onBack, onChanged }) {
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS, ...(worklist.weights ?? {}) });
  const [starred, setStarred] = useState(() => (worklist.starred_payers ?? []).map(String));
  const [band, setBand] = useState('ALL');
  const [payerF, setPayerF] = useState('ALL');
  const [statusF, setStatusF] = useState('ALL');
  const [assignedF, setAssignedF] = useState('ALL');
  const [picked, setPicked] = useState(() => new Set());
  const [assignTo, setAssignTo] = useState('');
  const [splitPeople, setSplitPeople] = useState(() => new Set());
  const [splitMode, setSplitMode] = useState('count');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState('');

  const names = useMemo(() => Object.fromEntries(people.map(p => [p.emp_id, p.name ?? p.emp_id])), [people]);
  const ranked = useMemo(() => prioritise(items, { weights, starred }), [items, weights, starred]);
  const payers = useMemo(() => [...new Set(items.map(i => i.payer_name).filter(Boolean))].sort(), [items]);
  const rows = ranked
    .filter(i => band === 'ALL' || i.band === band)
    .filter(i => payerF === 'ALL' || i.payer_name === payerF)
    .filter(i => statusF === 'ALL' || (statusF === 'open' ? !isDone(i.status) : i.status === statusF))
    .filter(i => assignedF === 'ALL' || (assignedF === 'none' ? !i.assigned_to : i.assigned_to === assignedF));
  const settingsChanged = JSON.stringify(weights) !== JSON.stringify({ ...DEFAULT_WEIGHTS, ...(worklist.weights ?? {}) })
    || JSON.stringify([...starred].sort()) !== JSON.stringify((worklist.starred_payers ?? []).map(String).sort());

  // Progress per person
  const day = today();
  const progress = people.map(p => {
    const mine = items.filter(i => i.assigned_to === p.emp_id);
    return {
      p, assigned: mine.length, remaining: mine.filter(i => !isDone(i.status)).length,
      workedToday: mine.filter(i => i.worked_at && i.worked_at.slice(0, 10) === day && i.worked_by === p.emp_id).length,
      overdue: mine.filter(i => i.follow_up && i.follow_up < day && !isDone(i.status)).length,
    };
  }).filter(r => r.assigned > 0);
  const unassigned = items.filter(i => !i.assigned_to).length;

  const togglePick = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = rows.slice(0, limit);
  const allPicked = allShown.length > 0 && allShown.every(i => picked.has(i.id));

  async function run(label, fn) {
    setBusy(label);
    await fn();
    setBusy('');
    setPicked(new Set());
    onChanged();
  }
  async function assign(empId) {
    const ids = [...picked];
    if (!ids.length) return;
    if (!await confirmDialog({
      title: empId ? `Assign ${ids.length} claim(s) to ${names[empId]}?` : `Unassign ${ids.length} claim(s)?`,
      message: 'People see their claims under My worklist.', confirmText: empId ? 'Assign' : 'Unassign',
    })) return;
    run('Assigning…', () => assignItems(ids, empId, user, worklist.id));
  }
  async function autoSplit() {
    const emps = [...splitPeople];
    const pool = picked.size ? ranked.filter(i => picked.has(i.id)) : ranked.filter(i => !i.assigned_to && !isDone(i.status));
    if (!emps.length || !pool.length) return;
    const plan = planSplit(pool, emps, splitMode);
    if (!await confirmDialog({
      title: `Split ${pool.length} claim(s) between ${emps.length} people?`,
      message: emps.map(e => `${names[e]}: ${plan[e].length}`).join(' · '),
      confirmText: 'Split',
    })) return;
    run('Assigning…', async () => { for (const e of emps) if (plan[e].length) await assignItems(plan[e], e, user, worklist.id); });
  }
  async function saveSettings() {
    run('Saving…', () => saveWorklistSettings(worklist, { weights, starred_payers: starred.map(Number) }, user));
  }
  async function clear() {
    if (!await confirmDialog({
      title: 'Close this worklist and clear claim details?',
      message: 'Claim numbers and dates of service are wiped from every claim. Statuses, amounts and counts are kept. This can’t be undone.',
      confirmText: 'Close & Clear', tone: 'warning',
    })) return;
    run('Clearing…', () => closeAndClear(worklist, user));
  }
  async function download() {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(ranked.map(i => ({
      Band: BANDS[i.band].label, Score: i.score, Reason: i.reason, 'Claim #': i.claim_number ?? '', Payer: i.payer_name ?? '',
      'DOS from': fmtUS(i.dos_from), 'DOS to': fmtUS(i.dos_to), Billed: i.billed ?? '', Balance: i.balance ?? '',
      'Aging (days)': i.aging_days ?? '', 'Denial date': fmtUS(i.denial_date), Deadline: fmtUS(i.deadline), 'Deadline type': i.deadline_type ?? '',
      'Assigned to': names[i.assigned_to] ?? i.assigned_to ?? '', Status: itemStatusOf(i.status).label, 'Follow-up': fmtUS(i.follow_up),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Worklist');
    XLSX.writeFile(wb, `${worklist.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'worklist'}.xlsx`);
  }

  const closed = worklist.status === 'closed';
  return (
    <div>
      <button className="btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>← All worklists</button>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="card-title">{worklist.name}</div>
          {closed && <span className="badge badge-gray">Closed{worklist.cleared_at ? ' – details cleared' : ''}</span>}
          <span className="text-sm text-muted">
            {items.length.toLocaleString()} claims · {unassigned} unassigned{worklist.count_task ? ` · counts as “${worklist.count_task}”` : ''}
            {worklist.client_id ? ` · ${ctx.clients.find(c => c.id === worklist.client_id)?.name ?? ''}` : ''}
          </span>
          <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
            <button className="btn-sm" onClick={download}>⬇ Excel</button>
            {!worklist.cleared_at && <button className="btn-sm" onClick={clear}>🔒 Close & clear details</button>}
          </span>
        </div>
      </div>

      {progress.length > 0 && (
        <div className="card mb-16" style={{ overflowX: 'auto' }}>
          <div className="card-title" style={{ marginBottom: 6 }}>Progress</div>
          <table className="text-sm" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left' }}>{['Person', 'Assigned', 'Worked today', 'Remaining', 'Overdue follow-ups'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {progress.map(r => (
                <tr key={r.p.emp_id}>
                  <td style={cell}>{r.p.name ?? r.p.emp_id}</td><td style={cell}>{r.assigned}</td><td style={cell}>{r.workedToday}</td>
                  <td style={cell}>{r.remaining}</td><td style={cell}>{r.overdue ? <span className="badge badge-red">{r.overdue}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!closed && (
        <div className="card mb-16">
          <div className="card-title" style={{ marginBottom: 6 }}>Priority</div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            {[['deadline', 'Deadline'], ['dollars', 'Dollars'], ['payer', 'Priority payers']].map(([k, label]) => (
              <label key={k} className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {label}: {['off', 'low', 'normal', 'high'][weights[k]] ?? weights[k]}
                <input type="range" min={0} max={3} step={1} value={weights[k]} onChange={e => setWeights(w => ({ ...w, [k]: Number(e.target.value) }))} />
              </label>
            ))}
          </div>
          {payers.length > 0 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              <span className="text-sm">★ Priority payers:</span>
              {payers.slice(0, 40).map(name => {
                const id = items.find(i => i.payer_name === name && i.payer_id)?.payer_id;
                if (!id) return null;
                const on = starred.includes(String(id));
                return (
                  <button key={name} type="button" className={on ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={on}
                    onClick={() => setStarred(s => (on ? s.filter(x => x !== String(id)) : [...s, String(id)]))}>{on ? '★ ' : ''}{name}</button>
                );
              })}
            </div>
          )}
          {settingsChanged && <button className="btn-primary btn-sm" style={{ marginTop: 8 }} onClick={saveSettings} disabled={!!busy}>Save priority settings</button>}
        </div>
      )}

      <div className="card mb-16">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <select value={band} onChange={e => setBand(e.target.value)} style={{ maxWidth: 140 }}>
            <option value="ALL">All bands</option>
            {Object.entries(BANDS).map(([k, b]) => <option key={k} value={k}>{b.icon} {b.label}</option>)}
          </select>
          <select value={payerF} onChange={e => setPayerF(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="ALL">All payers</option>
            {payers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="ALL">All statuses</option>
            <option value="open">Still open</option>
            {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={assignedF} onChange={e => setAssignedF(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="ALL">Anyone</option>
            <option value="none">Unassigned</option>
            {people.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name ?? p.emp_id}</option>)}
          </select>
          <span className="text-sm text-muted">{rows.length.toLocaleString()} shown · {picked.size} ticked</span>
        </div>

        {!closed && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, padding: 8, borderRadius: 6, background: 'var(--surface-2)' }}>
            <select value={assignTo} onChange={e => setAssignTo(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">Assign ticked to…</option>
              {people.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name ?? p.emp_id}{p.team ? ` (${p.team})` : ''}</option>)}
            </select>
            <button className="btn-sm" disabled={!picked.size || !assignTo || !!busy} onClick={() => assign(assignTo)}>Assign</button>
            <button className="btn-sm" disabled={!picked.size || !!busy} onClick={() => assign(null)}>Unassign</button>
            <details style={{ marginLeft: 'auto' }}>
              <summary className="text-sm" style={{ cursor: 'pointer' }}>⚡ Auto-split {picked.size ? 'ticked' : 'unassigned'} claims</summary>
              <div style={{ padding: 6 }}>
                <div className="row" style={{ gap: 4, flexWrap: 'wrap', maxWidth: 520 }}>
                  {people.map(p => {
                    const on = splitPeople.has(p.emp_id);
                    return (
                      <button key={p.emp_id} type="button" className={on ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={on}
                        onClick={() => setSplitPeople(s => { const n = new Set(s); if (n.has(p.emp_id)) n.delete(p.emp_id); else n.add(p.emp_id); return n; })}>
                        {on ? '✓ ' : ''}{p.name ?? p.emp_id}
                      </button>
                    );
                  })}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
                  <label className="row text-sm" style={{ gap: 4 }}><input type="radio" checked={splitMode === 'count'} onChange={() => setSplitMode('count')} /> Even by count</label>
                  <label className="row text-sm" style={{ gap: 4 }}><input type="radio" checked={splitMode === 'dollars'} onChange={() => setSplitMode('dollars')} /> Even by $</label>
                  <button className="btn-primary btn-sm" disabled={!splitPeople.size || !!busy} onClick={autoSplit}>Split</button>
                </div>
              </div>
            </details>
          </div>
        )}
        {busy && <div className="text-sm text-muted">⏳ {busy}</div>}

        <div style={{ overflowX: 'auto' }}>
          <table className="text-sm" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={cell}>{!closed && <input type="checkbox" checked={allPicked} aria-label="Tick all shown"
                  onChange={() => setPicked(s => { const n = new Set(s); allShown.forEach(i => (allPicked ? n.delete(i.id) : n.add(i.id))); return n; })} />}</th>
                {['Priority', 'Claim #', 'Payer', 'DOS', 'Balance', 'Assigned', 'Status', 'Follow-up'].map(h => <th key={h} style={cell}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {allShown.map(i => (
                <tr key={i.id}>
                  <td style={cell}>{!closed && <input type="checkbox" checked={picked.has(i.id)} onChange={() => togglePick(i.id)} aria-label="Tick claim" />}</td>
                  <td style={cell} title={i.reason}><span className={`badge ${BANDS[i.band].badge}`}>{BANDS[i.band].icon} {i.score}</span> <span className="text-muted">{i.reason}</span></td>
                  <td style={cell}>{i.claim_number ?? <span className="text-muted">cleared</span>}</td>
                  <td style={cell}>{i.payer_name ?? '—'}</td>
                  <td style={cell}>{fmtUS(i.dos_from)}{i.dos_to && i.dos_to !== i.dos_from ? `–${fmtUS(i.dos_to)}` : ''}</td>
                  <td style={cell}>{usd(i.balance)}</td>
                  <td style={cell}>{i.assigned_to ? names[i.assigned_to] ?? i.assigned_to : <span className="text-muted">—</span>}</td>
                  <td style={cell}>{itemStatusOf(i.status).label}</td>
                  <td style={cell}>{fmtUS(i.follow_up)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit && <button className="btn-sm" style={{ marginTop: 8 }} onClick={() => setLimit(l => l + PAGE)}>Show more ({rows.length - limit} left)</button>}
      </div>
    </div>
  );
}
