import { useState, useMemo } from 'react';
import { CREDIT_REPORT_DAYS, itemRef, isDone, daysLeft, optionLabel, quarterEnds } from '../../lib/medicareTrackers';
import { addDays } from '../../lib/helpers';
import MedicareTrackerList from './MedicareTrackerList';

const money = n => `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const isMedicare = p => /medicare|\bmac\b|palmetto|\bcgs\b|\bngs\b|novitas|noridian|first coast|wps/i.test(`${p?.name ?? ''} ${p?.payer_type ?? ''}`);

/**
 * 💸 Overpayments & credit balances (roadmap 7.5): payer overpayments / recoupments, credit balances and refund requests,
 * refund due = identified + 60 days. Quarter helper: Medicare credit balances open at a quarter end (CMS-838 prep).
 */
export default function OverpaymentTracker({ items, ctx, people, names, user, onChanged }) {
  const [quarter, setQuarter] = useState(() => quarterEnds(1)[0]);
  const [showQuarter, setShowQuarter] = useState(false);
  const payerOf = id => ctx.payers.find(p => p.id === id);

  // Credit balances that existed at the quarter end: identified by then and not closed before it
  const atQuarter = useMemo(() => items.filter(i => i.kind === 'credit_balance' && i.identified_on && i.identified_on <= quarter
    && (!i.closed_at || i.closed_at.slice(0, 10) > quarter) && (!i.payer_id || isMedicare(ctx.payers.find(p => p.id === i.payer_id)))), [items, quarter, ctx.payers]);
  const quarterTotal = atQuarter.reduce((t, i) => t + Number(i.amount ?? 0), 0);

  const badges = i => (
    <>
      <span className="text-sm text-muted">{optionLabel('overpayment', 'kind', i.kind)}</span>
      {!isDone('overpayment', i) && daysLeft(i) != null && (daysLeft(i) < 0
        ? <span className="badge badge-red">Refund overdue {-daysLeft(i)}d</span>
        : daysLeft(i) <= 14 ? <span className="badge badge-yellow">Refund due in {daysLeft(i)}d</span> : null)}
    </>
  );

  return (
    <>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>
        Refund due = identified + 60 days (Medicare 60-day overpayment rule) by default — check current rules.
      </p>

      {showQuarter && (
        <div className="card mb-16">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">🗓 Medicare credit balances at quarter end</div>
            <select value={quarter} onChange={e => setQuarter(e.target.value)} aria-label="Quarter end">
              {quarterEnds(4).map(q => <option key={q} value={q}>Quarter ending {fmtDate(q)}</option>)}
            </select>
          </div>
          <p className="text-sm" style={{ marginTop: 0 }}>
            <b>{atQuarter.length}</b> credit balances · <b>{money(quarterTotal)}</b> · credit balance report (CMS-838) due by
            {' '}<b>{fmtDate(addDays(quarter, CREDIT_REPORT_DAYS))}</b> <span className="text-muted">(quarter end + 30 days — check current CMS rules)</span>
          </p>
          {atQuarter.map(i => (
            <div key={i.id} className="row text-sm" style={{ gap: 8, flexWrap: 'wrap', padding: '3px 0', borderTop: '1px solid var(--border)' }}>
              <b>{itemRef('overpayment', i.id)}</b>
              <span>{ctx.clients.find(c => c.id === i.client_id)?.name ?? '—'}</span>
              <span className="text-muted">{payerOf(i.payer_id)?.name ?? 'No payer'}</span>
              {i.claim_number && <span className="text-muted">#{i.claim_number}</span>}
              <span>{money(i.amount)}</span>
              <span className="text-muted">identified {fmtDate(i.identified_on)}{i.closed_at ? ` · closed ${fmtDate(i.closed_at.slice(0, 10))}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      <MedicareTrackerList kind="overpayment" items={items} ctx={ctx} people={people} names={names} user={user} onChanged={onChanged}
        badges={badges} sortKey={i => daysLeft(i) ?? 9999}
        toolbar={<button className="btn-sm" style={{ marginRight: 6 }} onClick={() => setShowQuarter(s => !s)}>🗓 Quarter credit balances</button>} />
    </>
  );
}
