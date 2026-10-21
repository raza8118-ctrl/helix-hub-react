import { useState, useEffect, useMemo } from 'react';
import { RANGES, OUTCOMES, loadDenials, denialTrends, logExport } from '../../lib/reports';
import { addDays, today } from '../../lib/helpers';
import BarChart from '../../components/shared/BarChart';

const usd = n => `$${Math.round(n).toLocaleString()}`;
const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
const fmtWeek = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** One chart card: bar chart (claims) or table view (claims + $), switchable. */
function ChartCard({ title, rows, nameLabel, note }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="card mb-16" style={{ flex: '1 1 420px', minWidth: 0 }}>
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title">{title}</div>
        <button type="button" className="btn-sm" onClick={() => setAsTable(t => !t)}>{asTable ? '📊 Chart' : '▤ Table'}</button>
      </div>
      {note && <div className="text-sm text-muted" style={{ marginBottom: 6 }}>{note}</div>}
      {rows.length === 0 ? <div className="text-sm text-muted">No denials in this view.</div> : asTable ? (
        <div style={{ overflowX: 'auto', maxHeight: 320 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={cell}>{nameLabel}</th><th style={cell}>Claims</th><th style={cell}>Billed $</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.key}><td style={cell}>{r.name}</td><td style={cell}>{r.count}</td><td style={cell}>{r.amount != null ? usd(r.amount) : '—'}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <BarChart mode="value" suffix="" data={rows.slice(0, 10).map(r => ({ label: r.short ?? r.name, value: r.count }))} title={`${title} — claims`} />
      )}
    </div>
  );
}

/**
 * 🧩 Denial trends (roadmap 10.2): Smart Worklist claims with a denial date in the range — by payer, by client, by week,
 * top denial codes (when uploaded) and outcomes per payer. Excel has aggregates only (no claim numbers).
 */
export default function DenialTrends({ ctx, codes, user }) {
  const [range, setRange] = useState(90);
  const [from, setFrom] = useState(addDays(today(), -90));
  const [to, setTo] = useState(today());
  const [clientId, setClientId] = useState('');
  const [payerId, setPayerId] = useState('');
  const [claims, setClaims] = useState(undefined);       // undefined = loading, null = worklist not set up

  const span = range ? { from: addDays(today(), -range), to: today() } : { from, to };
  useEffect(() => {
    let alive = true;
    const s = range ? { from: addDays(today(), -range), to: today() } : { from, to };
    loadDenials({ ...s, clientId: clientId ? Number(clientId) : null, payerId: payerId ? Number(payerId) : null }, user)
      .then(c => { if (alive) setClaims(c); });
    return () => { alive = false; };
  }, [range, from, to, clientId, payerId, user]);

  const t = useMemo(() => (claims ? denialTrends(claims, { payers: ctx.payers, clients: ctx.clients, codes }) : null), [claims, ctx.payers, ctx.clients, codes]);

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const outcomeCols = r => Object.fromEntries(OUTCOMES.map(o => [o.label, r.outcomes[o.key]]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t.byPayer.map(r => ({ Payer: r.name, Claims: r.count, 'Billed $': Math.round(r.amount), ...outcomeCols(r) }))), 'By payer');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t.byClient.map(r => ({ Client: r.name, Claims: r.count, 'Billed $': Math.round(r.amount), ...outcomeCols(r) }))), 'By client');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t.weeks.map(r => ({ 'Week of': r.key, Claims: r.count, 'Billed $': Math.round(r.amount) }))), 'By week');
    if (t.byCode.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t.byCode.map(r => ({ Code: r.code, Reason: r.reason, Claims: r.count }))), 'By code');
    XLSX.writeFile(wb, `denial-trends-${span.from}-to-${span.to}.xlsx`);
    logExport(user, 'denial_trends', { from: span.from, to: span.to });
  }

  const payerOptions = useMemo(() => [...ctx.payers].sort((a, b) => a.name.localeCompare(b.name)), [ctx.payers]);

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={range} onChange={e => setRange(Number(e.target.value))} aria-label="Date range">
            {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {!range && (
            <>
              <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} aria-label="From" />
              <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="To" />
            </>
          )}
          <select value={clientId} onChange={e => setClientId(e.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={payerId} onChange={e => setPayerId(e.target.value)} aria-label="Payer">
            <option value="">All payers</option>
            {payerOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={exportExcel} disabled={!t?.total.count}>⬇ Excel</button>
        </div>
        <div className="text-sm text-muted" style={{ marginTop: 6 }}>Smart Worklist claims with a denial date from {span.from} to {span.to}.</div>
      </div>

      {claims === undefined && <div className="card text-muted">Loading…</div>}
      {claims === null && <div className="card text-muted">Denial trends need the Smart Worklist (<code>20261021j_worklists.sql</code>).</div>}

      {t && (
        <>
          <div className="row mb-16" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 160px', margin: 0 }}><div className="text-sm text-muted">Denied claims</div><div className="bold" style={{ fontSize: 22 }}>{t.total.count.toLocaleString()}</div></div>
            <div className="card" style={{ flex: '1 1 160px', margin: 0 }}><div className="text-sm text-muted">Billed $ denied</div><div className="bold" style={{ fontSize: 22 }}>{usd(t.total.amount)}</div></div>
            <div className="card" style={{ flex: '1 1 160px', margin: 0 }}>
              <div className="text-sm text-muted">Paid after denial</div>
              <div className="bold" style={{ fontSize: 22 }}>{t.total.count ? `${Math.round((t.byPayer.reduce((s, r) => s + r.outcomes.paid, 0) / t.total.count) * 100)}%` : '—'}</div>
            </div>
          </div>

          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <ChartCard title="By payer (top 10)" nameLabel="Payer" rows={t.byPayer.map(r => ({ ...r, short: r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name }))} />
            <ChartCard title="By client" nameLabel="Client" rows={t.byClient.map(r => ({ ...r, short: r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name }))} />
            <ChartCard title="Week by week" nameLabel="Week of" rows={t.weeks.map(r => ({ ...r, name: fmtWeek(r.key) }))} />
            <ChartCard title="Top denial codes" nameLabel="Code"
              note={t.total.withCode ? `${t.total.withCode} of ${t.total.count} claims had a code in the uploaded file.` : 'No denial codes yet — upload worklists with a reason-code column (CARC / RARC).'}
              rows={t.byCode.map(r => ({ key: r.code, name: r.reason ? `${r.code} — ${r.reason}` : r.code, short: r.code, count: r.count, amount: null }))} />
          </div>

          <div className="card mb-16">
            <div className="card-header"><div className="card-title">Outcomes by payer</div></div>
            {t.byPayer.length === 0 ? <div className="text-sm text-muted">No denials in this view.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><th style={cell}>Payer</th><th style={cell}>Denied</th>{OUTCOMES.map(o => <th key={o.key} style={cell}>{o.label}</th>)}</tr></thead>
                  <tbody>
                    {t.byPayer.map(r => (
                      <tr key={r.key}>
                        <td style={cell}>{r.name}</td>
                        <td style={cell} className="bold">{r.count}</td>
                        {OUTCOMES.map(o => <td key={o.key} style={cell}>{r.outcomes[o.key] || '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
