  const byClient = useMemo(() => {
    const nameOf = id => ctx.clients.find(c => c.id === id)?.name ?? '';
    return agingBy(queries, 'client_id').sort((a, b) => b.open - a.open || nameOf(a.key).localeCompare(nameOf(b.key)));
  }, [queries, ctx.clients]);import { useMemo } from 'react';
import { AGE_BUCKETS, agingBy, categoryLabel, statusOf, queryRef, ageDays, isOverdue } from '../../lib/clientQueries';

const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left' };
const num = v => (v ? v : '—');

/**
 * 📊 Aging (roadmap 7.3): open queries per client by age, overdue, escalated and average days to answer; open / overdue
 * per owner. Excel export has no claim numbers.
 */
export default function QueryAging({ queries, ctx, names }) {
  const clientName = id => ctx.clients.find(c => c.id === id)?.name ?? '—';
  const byClient = useMemo(() => {
    const nameOf = id => ctx.clients.find(c => c.id === id)?.name ?? '';
    return agingBy(queries, 'client_id').sort((a, b) => b.open - a.open || nameOf(a.key).localeCompare(nameOf(b.key)));
  }, [queries, ctx.clients]);
  const byOwner = useMemo(() => agingBy(queries, 'owner_emp_id').filter(r => r.open > 0).sort((a, b) => b.open - a.open), [queries]);
  const total = byClient.reduce((t, r) => ({ open: t.open + r.open, overdue: t.overdue + r.overdue, escalated: t.escalated + r.escalated }), { open: 0, overdue: 0, escalated: 0 });

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byClient.map(r => ({
      Client: clientName(r.key), Open: r.open, ...Object.fromEntries(AGE_BUCKETS.map(b => [`Age ${b.key} days`, r.buckets[b.key]])),
      Overdue: r.overdue, Escalated: r.escalated, Answered: r.answered, 'Average days to answer': r.avgDays,
    }))), 'Aging by client');
    // Query list without claim numbers
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(queries.map(q => ({
      Reference: queryRef(q.id), Client: clientName(q.client_id), About: categoryLabel(q.category), Priority: q.priority,
      Status: statusOf(q.status).label, 'Asked on': q.asked_on, 'Expected by': q.expected_on ?? '', 'Age (days)': ageDays(q),
      Overdue: isOverdue(q) ? 'Yes' : '', Escalated: q.escalated ? 'Yes' : '', Chases: q.chase_count ?? 0,
      Owner: names[q.owner_emp_id] ?? q.owner_emp_id, Question: q.question, Answer: q.answer ?? '',
    }))), 'Queries');
    XLSX.writeFile(wb, `client-queries-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div className="text-sm text-muted">Open</div><div className="bold" style={{ fontSize: 20 }}>{total.open}</div></div>
          <div><div className="text-sm text-muted">Overdue</div><div className="bold" style={{ fontSize: 20, color: total.overdue ? 'var(--danger)' : undefined }}>{total.overdue}</div></div>
          <div><div className="text-sm text-muted">Escalated</div><div className="bold" style={{ fontSize: 20 }}>{total.escalated}</div></div>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={exportExcel} disabled={!queries.length}>⬇ Excel</button>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">🏢 Open queries by client and age</div></div>
        {byClient.length === 0 ? <div className="text-sm text-muted">No queries yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Client', 'Open', ...AGE_BUCKETS.map(b => b.label), 'Overdue', 'Escalated', 'Avg days to answer'].map(h => <th key={h} style={cell}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {byClient.map(r => (
                  <tr key={r.key}>
                    <td style={cell}>{clientName(r.key)}</td>
                    <td style={cell} className="bold">{num(r.open)}</td>
                    {AGE_BUCKETS.map((b, i) => (
                      <td key={b.key} style={cell} className={r.buckets[b.key] && i >= 3 ? 'col-red' : r.buckets[b.key] && i === 2 ? 'col-yellow' : ''}>{num(r.buckets[b.key])}</td>
                    ))}
                    <td style={cell}>{r.overdue ? <span className="badge badge-red">{r.overdue}</span> : '—'}</td>
                    <td style={cell}>{r.escalated ? <span className="badge badge-purple">{r.escalated}</span> : '—'}</td>
                    <td style={cell}>{r.avgDays ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">👤 Open queries by owner</div></div>
        {byOwner.length === 0 ? <div className="text-sm text-muted">Nobody has open queries.</div> : byOwner.map(r => (
          <div key={r.key} className="row text-sm" style={{ gap: 8, padding: '3px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ flex: 1 }}>{names[r.key] ?? r.key}</span>
            <span>{r.open} open</span>
            {r.overdue > 0 && <span className="badge badge-red">{r.overdue} overdue</span>}
          </div>
        ))}
      </div>
    </>
  );
}
