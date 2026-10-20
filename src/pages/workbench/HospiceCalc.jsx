import { useState } from 'react';
import { noeResult, hospicePeriods } from '../../lib/medicareCalc';
import { fmtDue, fmtUS } from '../../lib/deadlines';
import { RuleNote } from './HomeHealthCalc';
import CopyButton from '../../components/shared/CopyButton';

const cell = { padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const fmtShort = d => fmtDue(d).replace(/^\w+, /, '');

/** 🕊️ Hospice calculators (roadmap 6.2): NOE due date + non-covered days, benefit periods with face-to-face flags. */
export default function HospiceCalc() {
  const [election, setElection] = useState('');
  const [accepted, setAccepted] = useState('');
  const [periodStart, setPeriodStart] = useState('');

  const noe = noeResult(election, accepted);
  const periods = hospicePeriods(periodStart, 6);
  const noeLine = noe && `NOE due ${fmtUS(noe.due)} (election ${fmtUS(election)} + 5 days)`
    + (noe.late ? ` – accepted ${fmtUS(accepted)}, late; ${noe.nonCovered} non-covered day(s) ${fmtUS(noe.nonCoveredFrom)}–${fmtUS(noe.nonCoveredTo)}` : noe.accepted ? ` – accepted ${fmtUS(accepted)}, on time` : '');
  const periodLine = periods.map(p => `BP${p.n} ${fmtUS(p.start)}–${fmtUS(p.end)}${p.f2f ? ' (F2F)' : ''}`).join('; ');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>📨 NOE due date</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Election date
            <input type="date" value={election} onChange={e => setElection(e.target.value)} />
          </label>
          <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>NOE accepted on (optional)
            <input type="date" value={accepted} onChange={e => setAccepted(e.target.value)} />
          </label>
        </div>
        {noe && (
          <div style={{ marginTop: 8 }}>
            <div className="bold">NOE due by {fmtDue(noe.due)}</div>
            {noe.weekend && <div className="text-sm">That’s a {noe.weekend} — CMS allows the next business day ({fmtShort(noe.nextBusiness)}) when day 5 is a weekend or federal holiday.</div>}
            {noe.accepted && !noe.late && <div className="text-sm" style={{ color: 'var(--success)' }}>✓ Accepted on time.</div>}
            {noe.late && (
              <div className="text-sm" style={{ color: 'var(--danger)' }}>
                🔴 Late. {noe.nonCovered} day(s) not covered ({fmtShort(noe.nonCoveredFrom)} – {fmtShort(noe.nonCoveredTo)}) — provider liability.
                Check whether an exception applies.
              </div>
            )}
            <div style={{ marginTop: 6 }}><CopyButton value={noeLine} label="📋 Copy result" /></div>
          </div>
        )}
        <RuleNote>The NOE must be filed and accepted within 5 calendar days after the election date; if late, the days from the
          election date to the day before the NOE is accepted are not covered.</RuleNote>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>📅 Benefit periods</div>
        <label className="text-sm" style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>Start of the 1st benefit period (election)
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
        </label>
        {periods.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="text-sm" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>{['Period', 'Days', 'From', 'Through', 'Face-to-face'].map(h => <th key={h} style={cell}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p.n}>
                    <td style={cell}>{p.n}</td>
                    <td style={cell}>{p.length}</td>
                    <td style={cell}>{fmtShort(p.start)}</td>
                    <td style={cell}>{fmtShort(p.end)}</td>
                    <td style={cell}>{p.f2f ? <span className="badge badge-orange">Needed {fmtShort(p.f2fFrom)} – {fmtShort(p.start)}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 6 }}><CopyButton value={periodLine} label="📋 Copy periods" /></div>
          </div>
        )}
        <RuleNote>Two 90-day periods, then unlimited 60-day periods; a face-to-face encounter is required within 30 days before the
          start of the 3rd and each later period. If the patient transferred from another hospice, start from their current period.</RuleNote>
      </div>
    </div>
  );
}
