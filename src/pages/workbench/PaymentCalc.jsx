import { useState } from 'react';
import { paymentResult, usd } from '../../lib/medicareCalc';
import { RuleNote } from './HomeHealthCalc';
import CopyButton from '../../components/shared/CopyButton';

const FIELDS = [
  { key: 'billed',         label: 'Billed amount $' },
  { key: 'allowed',        label: 'Allowed amount $ *' },
  { key: 'deductible',     label: 'Deductible applied $' },
  { key: 'copay',          label: 'Copay $' },
  { key: 'coinsurancePct', label: 'Coinsurance %' },
];

/** 💲 Expected payment (roadmap 6.2): contractual adjustment, patient share, payer payment, sequestration, net. */
export default function PaymentCalc() {
  const [v, setV] = useState({ billed: '', allowed: '', deductible: '', copay: '', coinsurancePct: '', seqOn: true, seqPct: '2', paid: '' });
  const set = patch => setV(x => ({ ...x, ...patch }));
  const r = paymentResult({ ...v, seqPct: v.seqOn ? v.seqPct : 0 });

  const rows = r ? [
    r.contractual != null && ['Contractual adjustment (billed − allowed)', r.contractual],
    ['Patient responsibility', r.patient],
    ['Payer payment before sequestration', r.payer],
    v.seqOn && [`Sequestration (${v.seqPct || 0}%)`, -r.seq],
    ['Expected payment', r.net, true],
    r.difference != null && [r.difference < 0 ? 'Underpaid by' : r.difference > 0 ? 'Overpaid by' : 'Paid exactly as expected', Math.abs(r.difference)],
  ].filter(Boolean) : [];
  const line = r && `Expected payment ${usd(r.net)} (allowed ${usd(parseFloat(String(v.allowed).replace(/[$,]/g, '')) || 0)}, patient ${usd(r.patient)}`
    + `${v.seqOn ? `, sequestration ${usd(r.seq)}` : ''})${r.difference != null && r.difference !== 0 ? ` – ${r.difference < 0 ? 'underpaid' : 'overpaid'} ${usd(Math.abs(r.difference))}` : ''}`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>💲 Claim amounts</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {FIELDS.map(f => (
            <label key={f.key} className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 140px' }}>{f.label}
              <input type="text" inputMode="decimal" value={v[f.key]} onChange={e => set({ [f.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={v.seqOn} onChange={e => set({ seqOn: e.target.checked })} /> Medicare sequestration
          </label>
          {v.seqOn && (
            <label className="row text-sm" style={{ gap: 4 }}>
              <input type="text" inputMode="decimal" value={v.seqPct} onChange={e => set({ seqPct: e.target.value })} style={{ width: 60 }} /> %
            </label>
          )}
        </div>
        <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, maxWidth: 200 }}>Actually paid $ (optional)
          <input type="text" inputMode="decimal" value={v.paid} onChange={e => set({ paid: e.target.value })} />
        </label>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Result</div>
        {!r && <div className="text-sm text-muted">Enter at least the allowed amount.</div>}
        {r && (
          <>
            <table className="text-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {rows.map(([label, value, strong]) => (
                  <tr key={label} style={{ borderBottom: '1px solid var(--border)', fontWeight: strong ? 700 : undefined }}>
                    <td style={{ padding: '5px 4px' }}>{label}</td>
                    <td style={{ padding: '5px 4px', textAlign: 'right' }}>{usd(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-sm text-muted" style={{ marginTop: 6 }}>
              Patient share: deductible {usd(r.deductible)}{r.copay ? ` + copay ${usd(r.copay)}` : ''}{r.coinsurance ? ` + coinsurance ${usd(r.coinsurance)}` : ''}.
            </div>
            <div style={{ marginTop: 8 }}><CopyButton value={line} label="📋 Copy result" /></div>
          </>
        )}
        <RuleNote>Medicare sequestration (currently 2%) applies to the payment after deductible and coinsurance; it isn’t billed to
          the patient. Untick it for non-Medicare payers.</RuleNote>
      </div>
    </div>
  );
}
