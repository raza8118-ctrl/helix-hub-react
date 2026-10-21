import { useState, useEffect, useMemo } from 'react';
import { loadHandovers } from '../../lib/handover';
import { escSummary, escTypeLabel, escRef, severityOf, escStatusOf, isOpenEsc, isOverdueEsc, escAgeDays } from '../../lib/escalations';
import { addDays, today } from '../../lib/helpers';

const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
const short = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

/**
 * 📊 Overview (roadmap 7.4, “Manage escalations”): who submitted a handover per shift date, carry-over items nobody has
 * taken, open escalations by type with age / overdue, average days to resolve. Excel has no claim numbers.
 */
export default function HandoverOverview({ people, escalations, ctx, names }) {
  const [days, setDays] = useState(5);
  const [handovers, setHandovers] = useState(null);
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(today(), -i)), [days]);

  const ids = useMemo(() => people.map(p => p.emp_id), [people]);
  useEffect(() => {
    let alive = true;
    loadHandovers(dates[dates.length - 1], dates[0], ids).then(h => { if (alive) setHandovers(h); });
    return () => { alive = false; };
  }, [dates, ids]);

  const scoped = useMemo(() => {
    const set = new Set(ids);
    return escalations.filter(e => set.has(e.raised_by) || set.has(e.assigned_to));
  }, [escalations, ids]);
  const summary = useMemo(() => escSummary(scoped), [scoped]);
  const submittedBy = useMemo(() => new Set((handovers ?? []).map(h => `${h.emp_id}|${h.shift_date}`)), [handovers]);
  const untaken = (handovers ?? []).flatMap(h => h.items.filter(i => i.status === 'open').map(i => ({ ...i, h })));
  const clientName = id => ctx.clients.find(c => c.id === id)?.name;
  const teams = [...new Set(people.map(p => p.team ?? 'No team'))].sort();

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(people.flatMap(p => dates.map(d => {
      const h = (handovers ?? []).find(x => x.emp_id === p.emp_id && x.shift_date === d);
      return { Person: p.name, Team: p.team ?? '', 'Shift date': d, Submitted: h ? 'Yes' : 'No', 'Carry-over items': h?.items.length ?? 0,
        'Not taken': h ? h.items.filter(i => i.status === 'open').length : 0 };
    }))), 'Handovers');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scoped.map(e => ({
      Reference: escRef(e.id), Title: e.title, Type: escTypeLabel(e.type), Severity: severityOf(e.severity).label, Status: escStatusOf(e.status).label,
      Client: clientName(e.client_id) ?? '', 'Raised by': names[e.raised_by] ?? e.raised_by, 'Goes to': names[e.assigned_to] ?? e.assigned_to ?? '',
      Raised: e.created_at.slice(0, 10), Target: e.target_date ?? '', 'Age (days)': escAgeDays(e), Overdue: isOverdueEsc(e) ? 'Yes' : '',
    }))), 'Escalations');
    XLSX.writeFile(wb, `handover-escalations-${today()}.xlsx`);
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div className="text-sm text-muted">Open escalations</div><div className="bold" style={{ fontSize: 20 }}>{summary.open}</div></div>
          <div><div className="text-sm text-muted">Overdue</div><div className="bold" style={{ fontSize: 20, color: summary.overdue ? 'var(--danger)' : undefined }}>{summary.overdue}</div></div>
          <div><div className="text-sm text-muted">Avg days to resolve</div><div className="bold" style={{ fontSize: 20 }}>{summary.avgResolveDays ?? '—'}</div></div>
          <div><div className="text-sm text-muted">Carry-over not taken</div><div className="bold" style={{ fontSize: 20 }}>{untaken.length}</div></div>
          <select value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Days shown" style={{ marginLeft: 'auto' }}>
            {[3, 5, 7, 14].map(n => <option key={n} value={n}>Last {n} days</option>)}
          </select>
          <button className="btn-sm" onClick={exportExcel} disabled={!handovers}>⬇ Excel</button>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">📝 Handovers submitted</div></div>
        {!handovers ? <div className="text-sm text-muted">Loading…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><th style={cell}>Person</th>{dates.map(d => <th key={d} style={cell}>{short(d)}</th>)}</tr></thead>
              <tbody>
                {teams.map(t => [
                  <tr key={`t-${t}`}><td colSpan={dates.length + 1} style={{ ...cell, fontWeight: 600, background: 'var(--surface-2, transparent)' }}>{t}</td></tr>,
                  ...people.filter(p => (p.team ?? 'No team') === t).map(p => (
                    <tr key={p.emp_id}>
                      <td style={cell}>{p.name}</td>
                      {dates.map(d => <td key={d} style={cell} className={submittedBy.has(`${p.emp_id}|${d}`) ? 'col-green' : 'text-muted'}>{submittedBy.has(`${p.emp_id}|${d}`) ? '✓' : '—'}</td>)}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {untaken.length > 0 && (
        <div className="card mb-16">
          <div className="card-header"><div className="card-title">📦 Carry-over nobody has taken</div></div>
          {untaken.map(i => (
            <div key={i.id} className="row text-sm" style={{ gap: 8, flexWrap: 'wrap', padding: '3px 0', borderTop: '1px solid var(--border)' }}>
              {i.priority === 'urgent' && <span className="badge badge-red">Urgent</span>}
              <span style={{ flex: '1 1 240px' }}>{i.what}</span>
              <span className="text-muted">{names[i.h.emp_id] ?? i.h.emp_id} · {short(i.h.shift_date)}{clientName(i.client_id) ? ` · ${clientName(i.client_id)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">⚑ Open escalations by type</div></div>
        {summary.byType.length === 0 ? <div className="text-sm text-muted">No open escalations.</div> : (
          <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
            <thead><tr>{['Type', 'Open', 'Overdue', 'Oldest (days)'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {summary.byType.map(t => (
                <tr key={t.type}>
                  <td style={cell}>{escTypeLabel(t.type)}</td>
                  <td style={cell}>{t.open}</td>
                  <td style={cell}>{t.overdue ? <span className="badge badge-red">{t.overdue}</span> : '—'}</td>
                  <td style={cell}>{t.oldest ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {scoped.filter(isOverdueEsc).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="bold text-sm">Overdue</div>
            {scoped.filter(e => isOpenEsc(e) && isOverdueEsc(e)).map(e => (
              <div key={e.id} className="row text-sm" style={{ gap: 8, flexWrap: 'wrap', padding: '3px 0' }}>
                <b>{escRef(e.id)}</b><span style={{ flex: '1 1 200px' }}>{e.title}</span>
                <span className={`badge ${severityOf(e.severity).badge}`}>{severityOf(e.severity).label}</span>
                <span className="text-muted">→ {names[e.assigned_to] ?? e.assigned_to ?? '—'} · target {e.target_date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
