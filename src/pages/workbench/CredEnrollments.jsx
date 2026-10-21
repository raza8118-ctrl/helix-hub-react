import { useState, useMemo } from 'react';
import { KINDS, ENROLL_STATUSES, PROVIDER_TYPES, labelOf, statusOf } from '../../lib/credentialing';
import { today } from '../../lib/helpers';
import CredEditor from './CredEditor';

const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
const SHORT = { not_started: '—', submitted: 'Submitted', in_process: 'In process', approved: '✓ Approved', denied: 'Denied', termed: 'Termed' };

/**
 * 🏥 Enrollments (roadmap 9.3): provider × payer grid of enrollment status (payers that appear in any enrollment).
 * Editors click a cell to edit / add; everyone can open the provider; ⬇ Excel of the grid.
 */
export default function CredEnrollments({ data, ctx, user, canEdit, onOpen, onChanged }) {
  const [kind, setKind] = useState('agency');
  const [status, setStatus] = useState('ALL');
  const [editing, setEditing] = useState(null);           // { row? , extra?, preset? }
  const payerName = id => ctx.payers.find(p => p.id === id)?.name ?? 'Payer';

  const providers = useMemo(() => data.providers.filter(p => p.active !== false && (kind === 'ALL' || p.kind === kind)), [data.providers, kind]);
  const live = useMemo(() => data.enrollments.filter(e => e.active !== false), [data.enrollments]);
  const payerIds = useMemo(() => {
    const nameOf = id => ctx.payers.find(p => p.id === id)?.name ?? '';
    const ids = new Set(providers.flatMap(p => live.filter(e => e.provider_id === p.id).map(e => e.payer_id)));
    return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [providers, live, ctx.payers]);
  const at = (pid, payerId) => live.find(e => e.provider_id === pid && e.payer_id === payerId);
  const rows = providers.filter(p => status === 'ALL' || payerIds.some(id => at(p.id, id)?.status === status));

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(rows.map(p => ({
      Provider: p.name, Kind: labelOf(KINDS, p.kind), Type: labelOf(PROVIDER_TYPES, p.provider_type), NPI: p.npi ?? '',
      Client: ctx.clients.find(c => c.id === p.client_id)?.name ?? '',
      ...Object.fromEntries(payerIds.map(id => { const e = at(p.id, id); return [payerName(id), e ? statusOf(e.status).label : '']; })),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Enrollments');
    XLSX.writeFile(wb, `credentialing-enrollments-${today()}.xlsx`);
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            <option value="ALL">All providers</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
            <option value="ALL">Any status</option>
            {ENROLL_STATUSES.map(s => <option key={s.value} value={s.value}>Has: {s.label}</option>)}
          </select>
          <span className="text-sm text-muted">Add a payer to a provider from the provider page.</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={exportExcel} disabled={!rows.length}>⬇ Excel</button>
        </div>
      </div>
      {rows.length === 0 || payerIds.length === 0 ? (
        <div className="card text-muted" style={{ textAlign: 'center' }}>No enrollments recorded yet.</div>
      ) : (
        <div className="card mb-16" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={cell}>Provider</th>{payerIds.map(id => <th key={id} style={cell}>{payerName(id)}</th>)}</tr></thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td style={cell}><button type="button" className="btn-sm" onClick={() => onOpen(p.id)}>{p.name}</button></td>
                  {payerIds.map(id => {
                    const e = at(p.id, id);
                    const label = e ? SHORT[e.status] ?? statusOf(e.status).label : '';
                    return (
                      <td key={id} style={cell}>
                        {e
                          ? (canEdit
                            ? <button type="button" className={`badge ${statusOf(e.status).badge}`} style={{ cursor: 'pointer', border: 0 }} onClick={() => setEditing({ row: e })}>{label}</button>
                            : <span className={`badge ${statusOf(e.status).badge}`}>{label}</span>)
                          : canEdit && <button type="button" className="btn-sm" title="Add enrollment" onClick={() => setEditing({ extra: { provider_id: p.id }, preset: { payer_id: id } })}>+</button>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CredEditor kind="enrollment" row={editing.row ?? null} extra={editing.extra} preset={editing.preset} ctx={ctx} user={user}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </>
  );
}
