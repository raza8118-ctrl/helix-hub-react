import { useState } from 'react';
import { noaResult, pdgmPeriods, lupaResult, usd } from '../../lib/medicareCalc';
import { fmtDue, fmtUS } from '../../lib/deadlines';
import CopyButton from '../../components/shared/CopyButton';

const cell = { padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const fmtShort = d => fmtDue(d).replace(/^\w+, /, '');

/** "⚠ Check current CMS rules" with the rule used. */
export function RuleNote({ children }) {
  return <div className="text-sm text-muted" style={{ marginTop: 8 }}>⚠ Check current CMS rules. {children}</div>;
}

/** 🏠 Home health calculators (roadmap 6.2): NOA due date + late penalty, PDGM 30-day periods, LUPA check. */
export default function HomeHealthCalc() {
  const [from, setFrom] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [payment, setPayment] = useState('');
  const [soc, setSoc] = useState('');
  const [threshold, setThreshold] = useState('');
  const [visits, setVisits] = useState('');

  const noa = noaResult(from, submitted, payment);
  const periods = pdgmPeriods(soc, 6);
  const lupa = lupaResult(threshold, visits);

  const noaLine = noa && `NOA due ${fmtUS(noa.due)} (From ${fmtUS(from)} + 5 days)`
    + (noa.late ? ` – submitted ${fmtUS(submitted)}, ${noa.daysAfterDue} day(s) late; reduction for ${noa.lateDays} day(s)${noa.reduction != null ? ` ≈ ${usd(noa.reduction)}` : ''}` : noa.submitted ? ` – submitted ${fmtUS(submitted)}, on time` : '');
  const pdgmLine = periods.length ? periods.map(p => `P${p.n} ${fmtUS(p.start)}–${fmtUS(p.end)} (${p.timing})`).join('; ') : '';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>📨 NOA due date</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Period From date
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>NOA submitted on (optional)
            <input type="date" value={submitted} onChange={e => setSubmitted(e.target.value)} />
          </label>
          <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>30-day period payment $ (optional)
            <input type="text" value={payment} onChange={e => setPayment(e.target.value)} placeholder="e.g. 2,000.00" style={{ width: 140 }} />
          </label>
        </div>
        {noa && (
          <div style={{ marginTop: 8 }}>
            <div className="bold">NOA due by {fmtDue(noa.due)}</div>
            {noa.weekend && <div className="text-sm">That’s a {noa.weekend} — CMS allows the next business day ({fmtShort(noa.nextBusiness)}) when day 5 is a weekend or federal holiday.</div>}
            {noa.submitted && !noa.late && <div className="text-sm" style={{ color: 'var(--success)' }}>✓ Submitted on time.</div>}
            {noa.late && (
              <div className="text-sm" style={{ color: 'var(--danger)' }}>
                🔴 {noa.daysAfterDue} day(s) late. Payment reduced for {noa.lateDays} day(s) (From date until submission)
                {noa.reduction != null && <> — about <b>{usd(noa.reduction)}</b></>}.
                Check whether an exception applies.
              </div>
            )}
            <div style={{ marginTop: 6 }}><CopyButton value={noaLine} label="📋 Copy result" /></div>
          </div>
        )}
        <RuleNote>NOA due within 5 calendar days after the From date; if late, the period payment is reduced by 1/30 for each day from the From date until the NOA is submitted (never more than the period payment).</RuleNote>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>🧾 LUPA check</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>LUPA threshold (2–6)
            <input type="number" min={1} max={10} value={threshold} onChange={e => setThreshold(e.target.value)} style={{ width: 110 }} />
          </label>
          <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Visits in the 30-day period
            <input type="number" min={0} value={visits} onChange={e => setVisits(e.target.value)} style={{ width: 110 }} />
          </label>
        </div>
        {lupa && (
          <div style={{ marginTop: 8 }}>
            {lupa.lupa
              ? <div className="bold" style={{ color: 'var(--warning)' }}>🟠 LUPA — paid per visit ({lupa.visits} of {lupa.threshold}; {lupa.needed} more visit(s) would clear it).</div>
              : <div className="bold" style={{ color: 'var(--success)' }}>✓ Not a LUPA ({lupa.visits} visits, threshold {lupa.threshold}).</div>}
            <div style={{ marginTop: 6 }}>
              <CopyButton value={lupa.lupa ? `LUPA: ${lupa.visits} visit(s), threshold ${lupa.threshold}` : `Not LUPA: ${lupa.visits} visits, threshold ${lupa.threshold}`} label="📋 Copy result" />
            </div>
          </div>
        )}
        <RuleNote>The threshold depends on the period’s case-mix group (from the HIPPS / grouper) and changes each year — it isn’t built in.</RuleNote>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-title" style={{ marginBottom: 8 }}>📅 PDGM 30-day periods</div>
        <label className="text-sm" style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>Start of care
          <input type="date" value={soc} onChange={e => setSoc(e.target.value)} />
        </label>
        {periods.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="text-sm" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  {['Period', 'From', 'Through', 'Timing', 'Certification', 'Recert window'].map(h => <th key={h} style={cell}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p.n}>
                    <td style={cell}>{p.n}</td>
                    <td style={cell}>{fmtShort(p.start)}</td>
                    <td style={cell}>{fmtShort(p.end)}</td>
                    <td style={cell}><span className={`badge ${p.timing === 'Early' ? 'badge-blue' : 'badge-gray'}`}>{p.timing}</span></td>
                    <td style={cell}>{p.n % 2 === 1 ? `Cert ${p.cert}: ${fmtShort(p.certStart)} – ${fmtShort(p.certEnd)}` : '〃'}</td>
                    <td style={cell}>{p.n % 2 === 0 ? `${fmtShort(p.recertFrom)} – ${fmtShort(p.recertTo)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 6 }}><CopyButton value={pdgmLine} label="📋 Copy periods" /></div>
          </div>
        )}
        <RuleNote>Two 30-day periods per 60-day certification; the first period of a sequence is “early”, later ones “late”;
          recertification in the last 5 days of the certification (days 56–60). A gap of more than 60 days starts a new sequence (early again).</RuleNote>
      </div>
    </div>
  );
}
