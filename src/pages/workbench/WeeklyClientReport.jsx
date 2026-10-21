import { useState, useEffect, useMemo } from 'react';
import { OUTCOMES, mondayOf, lastWeek, loadWeekly, weeklySummary, weeklyEmail, aiWeeklySummary, logExport } from '../../lib/reports';
import { addDays } from '../../lib/helpers';
import { escHtml } from '../../lib/sopText';
import CopyButton from '../../components/shared/CopyButton';

const usd = n => `$${Math.round(n).toLocaleString()}`;
const fmt = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const Stat = ({ label, value, tone }) => (
  <div style={{ flex: '1 1 140px' }}>
    <div className="text-sm text-muted">{label}</div>
    <div className="bold" style={{ fontSize: 20, color: tone === 'bad' && value ? 'var(--danger)' : undefined }}>{value}</div>
  </div>
);

/**
 * 🗓 Weekly client report (roadmap 10.2): one client, one week (Mon–Sun) — claims worked + outcomes, new denials, open
 * follow-ups, client queries, escalations, Medicare items and this month's payer changes. 📋 email text, 🖨 print,
 * ⬇ Excel and an optional ✨ AI summary from the numbers only. No claim numbers anywhere.
 */
export default function WeeklyClientReport({ ctx, user }) {
  const [clientId, setClientId] = useState('');
  const [weekOf, setWeekOf] = useState(lastWeek().from);
  const [raw, setRaw] = useState(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [summary, setSummary] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  const from = mondayOf(weekOf);
  const to = addDays(from, 6);
  const key = `${clientId}|${from}`;
  useEffect(() => {
    let alive = true;
    if (clientId) loadWeekly({ clientId: Number(clientId), from, to }, user).then(r => { if (alive) { setRaw(r); setLoadedKey(`${clientId}|${from}`); } });
    return () => { alive = false; };
  }, [clientId, from, to, user]);

  const client = ctx.clients.find(c => String(c.id) === clientId);
  const ready = clientId && raw && loadedKey === key;
  const s = useMemo(() => (ready ? weeklySummary(raw, { from, to, payers: ctx.payers }) : null), [ready, raw, from, to, ctx.payers]);
  const email = s ? `${summary ? `${summary}\n\n` : ''}${weeklyEmail(s, { clientName: client?.name ?? '', from, to })}` : '';

  async function writeSummary() {
    setAiBusy(true); setAiError('');
    try { setSummary(await aiWeeklySummary(s, client.name, user)); } catch (e) { setAiError(e.message === 'NO_KEY' ? 'No AI key is saved in Settings.' : e.message); }
    setAiBusy(false);
  }
  function print() {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${escHtml(client.name)} — week of ${escHtml(from)}</title>
      <body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;line-height:1.5">
      <pre style="white-space:pre-wrap;font-family:inherit">${escHtml(email)}</pre></body>`);
    w.document.close();
    w.print();
    logExport(user, 'weekly_client', { client_id: client.id, from, to, kind: 'print' });
  }
  async function exportExcel() {
    const XLSX = await import('xlsx');
    const rows = email.split('\n').filter(Boolean).map(line => ({ Item: line.trim() }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Weekly report');
    if (s.worked?.topPayers.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.worked.topPayers.map(p => ({ Payer: p.name, 'Claims worked': p.count, 'Billed $': Math.round(p.amount) }))), 'Worked by payer');
    if (s.payerChanges?.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.payerChanges.map(c => ({ Payer: c.payer, Effective: c.effective, Change: c.change, Action: c.action ?? '' }))), 'Payer changes');
    XLSX.writeFile(wb, `weekly-${(client.name ?? 'client').replace(/[^A-Za-z0-9]+/g, '-')}-${from}.xlsx`);
    logExport(user, 'weekly_client', { client_id: client.id, from, to, kind: 'excel' });
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 240px', marginBottom: 0 }}><label>Client</label>
            <select value={clientId} onChange={e => { setClientId(e.target.value); setSummary(''); }}>
              <option value="">— Choose —</option>
              {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 180px', marginBottom: 0 }}><label>Week of (any day)</label>
            <input type="date" value={weekOf} onChange={e => { if (e.target.value) { setWeekOf(e.target.value); setSummary(''); } }} />
          </div>
          <span className="text-sm text-muted">{fmt(from)} – {fmt(to)}</span>
        </div>
      </div>

      {!clientId && <div className="card text-muted" style={{ textAlign: 'center' }}>Choose a client to build its weekly report.</div>}
      {clientId && !ready && <div className="card text-muted">Loading…</div>}

      {s && (
        <>
          <div className="card mb-16">
            <div className="card-header"><div className="card-title">📋 Claims</div></div>
            {s.worked ? (
              <>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Stat label="Claims worked" value={s.worked.count} />
                  <Stat label="Billed $ worked" value={usd(s.worked.amount)} />
                  <Stat label="New denials" value={s.denials?.count ?? '—'} tone="bad" />
                  <Stat label="Open follow-ups" value={s.followupsOpen ?? '—'} />
                </div>
                <div className="text-sm" style={{ marginTop: 8 }}>
                  {OUTCOMES.map(o => `${o.label}: ${s.worked.outcomes[o.key]}`).join(' · ')}
                </div>
                {s.worked.topPayers.length > 0 && <div className="text-sm text-muted" style={{ marginTop: 4 }}>Top payers worked: {s.worked.topPayers.map(p => `${p.name} (${p.count})`).join(', ')}</div>}
              </>
            ) : <div className="text-sm text-muted">The Smart Worklist isn’t set up yet.</div>}
          </div>

          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div className="card mb-16" style={{ flex: '1 1 300px' }}>
              <div className="card-header"><div className="card-title">💬 Client queries</div></div>
              {s.queries ? (
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Stat label="Asked" value={s.queries.asked} /><Stat label="Answered" value={s.queries.answered} />
                  <Stat label="Open" value={s.queries.open} /><Stat label="Waiting on client" value={s.queries.waiting} tone="bad" />
                  {s.queries.oldest > 0 && <Stat label="Oldest open (days)" value={s.queries.oldest} />}
                </div>
              ) : <div className="text-sm text-muted">Not set up yet.</div>}
            </div>
            <div className="card mb-16" style={{ flex: '1 1 300px' }}>
              <div className="card-header"><div className="card-title">⚑ Escalations</div></div>
              {s.escalations ? (
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Stat label="Opened" value={s.escalations.opened} /><Stat label="Resolved" value={s.escalations.resolved} /><Stat label="Open now" value={s.escalations.open} />
                </div>
              ) : <div className="text-sm text-muted">Not set up yet.</div>}
            </div>
            <div className="card mb-16" style={{ flex: '1 1 300px' }}>
              <div className="card-header"><div className="card-title">🏛️ Medicare</div></div>
              {s.medicare ? (
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Stat label="ADRs open" value={s.medicare.adrOpen} /><Stat label="ADRs due ≤ 14 days" value={s.medicare.adrDue14} tone="bad" />
                  <Stat label="Overpayments open" value={`${s.medicare.overpaymentOpen} · ${usd(s.medicare.overpaymentAmount)}`} /><Stat label="RTP / suspense" value={s.medicare.rtpOpen} />
                </div>
              ) : <div className="text-sm text-muted">Not set up yet.</div>}
            </div>
          </div>

          {s.payerChanges?.length > 0 && (
            <div className="card mb-16">
              <div className="card-header"><div className="card-title">📰 Payer changes this month</div></div>
              {s.payerChanges.map((c, i) => (
                <div key={i} className="text-sm" style={{ padding: '3px 0', borderTop: '1px solid var(--border)' }}>
                  <b>{c.payer}</b> · {c.effective} — {c.change}{c.action ? <span className="text-muted"> ({c.action})</span> : null}
                </div>
              ))}
            </div>
          )}

          <div className="card mb-16">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title">✉️ Email to the client</div>
              <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-sm" onClick={writeSummary} disabled={aiBusy}>{aiBusy ? 'Writing…' : summary ? '✨ Rewrite summary' : '✨ Write summary'}</button>
                <CopyButton value={email} label="📋 Copy email text" />
                <button className="btn-sm" onClick={print}>🖨 Print</button>
                <button className="btn-sm" onClick={exportExcel}>⬇ Excel</button>
              </span>
            </div>
            {aiError && <div className="text-sm" style={{ color: 'var(--danger)', marginBottom: 6 }}>{aiError}</div>}
            <pre className="text-sm" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{email}</pre>
            <div className="text-sm text-muted" style={{ marginTop: 6 }}>🔒 Counts and names only — no claim numbers. The AI summary is written from these numbers alone.</div>
          </div>
        </>
      )}
    </>
  );
}
