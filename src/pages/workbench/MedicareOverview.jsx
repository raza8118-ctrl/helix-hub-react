import { useMemo } from 'react';
import { TRACKERS, ADR_WARN_DAYS, itemRef, isDone, daysLeft, rtpAge, statusOf, optionLabel } from '../../lib/medicareTrackers';
import { today } from '../../lib/helpers';

const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left' };
const money = n => `$${Math.round(Number(n ?? 0)).toLocaleString()}`;
const sum = list => list.reduce((t, i) => t + Number(i.amount ?? 0), 0);

/**
 * 📊 Medicare overview (roadmap 7.5): ADRs due soon / overdue with $ at risk, overpayments owed and past 60 days,
 * RTP / suspense by age — totals and per client. Excel export has no claim numbers.
 */
export default function MedicareOverview({ data, ctx, names, onOpen }) {
  const clientName = id => ctx.clients.find(c => c.id === id)?.name ?? '—';
  const openAdr = data.adr.filter(i => !isDone('adr', i));
  const adrSoon = openAdr.filter(i => daysLeft(i) != null && daysLeft(i) >= 0 && daysLeft(i) <= ADR_WARN_DAYS);
  const adrLate = openAdr.filter(i => daysLeft(i) != null && daysLeft(i) < 0);
  const openOp = data.overpayment.filter(i => !isDone('overpayment', i));
  const opLate = openOp.filter(i => daysLeft(i) != null && daysLeft(i) < 0);
  const openRtp = data.rtp.filter(i => !isDone('rtp', i));
  const rtpOld = openRtp.filter(i => rtpAge(i) > 14);

  const perClient = useMemo(() => {
    const by = {};
    const row = id => (by[id] ??= { id, adr: 0, adrLate: 0, adrRisk: 0, op: 0, opAmount: 0, opLate: 0, rtp: 0, rtpOld: 0 });
    for (const i of data.adr) if (!isDone('adr', i)) { const r = row(i.client_id); r.adr += 1; r.adrRisk += Number(i.amount ?? 0); if ((daysLeft(i) ?? 1) < 0) r.adrLate += 1; }
    for (const i of data.overpayment) if (!isDone('overpayment', i)) { const r = row(i.client_id); r.op += 1; r.opAmount += Number(i.amount ?? 0); if ((daysLeft(i) ?? 1) < 0) r.opLate += 1; }
    for (const i of data.rtp) if (!isDone('rtp', i)) { const r = row(i.client_id); r.rtp += 1; if (rtpAge(i) > 14) r.rtpOld += 1; }
    return Object.values(by).sort((a, b) => (b.adrLate + b.opLate + b.rtpOld) - (a.adrLate + a.opLate + a.rtpOld) || (b.adr + b.op + b.rtp) - (a.adr + a.op + a.rtp));
  }, [data]);

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    // No claim numbers in the export
    const sheet = kind => data[kind].map(i => ({
      Reference: itemRef(kind, i.id), Client: clientName(i.client_id), Status: statusOf(kind, i[TRACKERS[kind].statusKey]).label,
      Finished: isDone(kind, i) ? 'Yes' : '', Owner: names[i.owner_emp_id] ?? i.owner_emp_id ?? '', 'Amount $': i.amount ?? '',
      ...(kind === 'adr' ? { 'ADR date': i.adr_date ?? '', 'Due': i.due_date ?? '', 'Submitted': i.submitted_on ?? '', 'Decision': i.decision ?? '' } : {}),
      ...(kind === 'overpayment' ? { What: optionLabel(kind, 'kind', i.kind), Reason: optionLabel(kind, 'reason', i.reason), Identified: i.identified_on ?? '', 'Refund due': i.due_date ?? '', Refunded: i.refunded_on ?? '', 'Refunded $': i.refunded_amount ?? '' } : {}),
      ...(kind === 'rtp' ? { Location: i.location ?? '', 'Reason code': i.reason_code ?? '', 'Days in status': rtpAge(i), 'In FISS': i.in_fiss === false ? 'No' : 'Yes' } : {}),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet('adr')), 'ADRs');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet('overpayment')), 'Overpayments');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet('rtp')), 'RTP-suspense');
    XLSX.writeFile(wb, `medicare-trackers-${today()}.xlsx`);
  }

  const tile = (label, value, tone, tab) => (
    <button type="button" className="card" onClick={() => onOpen(tab)} style={{ flex: '1 1 160px', textAlign: 'left', cursor: 'pointer', margin: 0 }}>
      <div className="text-sm text-muted">{label}</div>
      <div className="bold" style={{ fontSize: 20, color: tone === 'bad' && value ? 'var(--danger)' : undefined }}>{value}</div>
    </button>
  );

  return (
    <>
      <div className="row mb-16" style={{ gap: 10, flexWrap: 'wrap' }}>
        {tile('ADRs open · $ at risk', `${openAdr.length} · ${money(sum(openAdr))}`, null, 'adr')}
        {tile(`ADRs due in ≤ ${ADR_WARN_DAYS} days`, adrSoon.length, 'bad', 'adr')}
        {tile('ADRs overdue', adrLate.length, 'bad', 'adr')}
        {tile('Overpayments open · $', `${openOp.length} · ${money(sum(openOp))}`, null, 'overpayment')}
        {tile('Refunds past due', opLate.length, 'bad', 'overpayment')}
        {tile('RTP / suspense open', openRtp.length, null, 'rtp')}
        {tile('RTP / suspense > 14 days', rtpOld.length, 'bad', 'rtp')}
      </div>

      <div className="card mb-16">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title">🏢 By client</div>
          <button className="btn-sm" onClick={exportExcel}>⬇ Excel</button>
        </div>
        {perClient.length === 0 ? <div className="text-sm text-muted">Nothing open — add ADRs, overpayments or upload an RTP list.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Client', 'ADRs', 'ADRs overdue', '$ at risk', 'Overpayments', '$ owed', 'Refunds past due', 'RTP / suspense', '> 14 days'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
              <tbody>
                {perClient.map(r => (
                  <tr key={r.id ?? 'none'}>
                    <td style={cell}>{clientName(r.id)}</td>
                    <td style={cell}>{r.adr || '—'}</td>
                    <td style={cell}>{r.adrLate ? <span className="badge badge-red">{r.adrLate}</span> : '—'}</td>
                    <td style={cell}>{r.adrRisk ? money(r.adrRisk) : '—'}</td>
                    <td style={cell}>{r.op || '—'}</td>
                    <td style={cell}>{r.opAmount ? money(r.opAmount) : '—'}</td>
                    <td style={cell}>{r.opLate ? <span className="badge badge-red">{r.opLate}</span> : '—'}</td>
                    <td style={cell}>{r.rtp || '—'}</td>
                    <td style={cell}>{r.rtpOld ? <span className="badge badge-red">{r.rtpOld}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-sm text-muted">Due dates are defaults (ADR + 45 days, refund + 60 days) — always check the letter and current CMS rules.</p>
    </>
  );
}
