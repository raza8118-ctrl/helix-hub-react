import { useState, useMemo } from 'react';
import {
  KINDS, PROVIDER_TYPES, ITEM_TYPES, CAQH_DAYS, labelOf, statusOf, statusChecklist, setCredActive,
} from '../../lib/credentialing';
import { addDays, today } from '../../lib/helpers';
import { daysBetween } from '../../lib/deadlines';
import CopyButton from '../../components/shared/CopyButton';
import CredEditor from './CredEditor';

const fmtDate = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const leftBadge = d => {
  if (!d) return null;
  const n = daysBetween(today(), d);
  const cls = n < 0 ? 'badge-red' : n <= 30 ? 'badge-yellow' : n <= 90 ? 'badge-gray' : 'badge-green';
  return <span className={`badge ${cls}`}>{n < 0 ? `${-n}d overdue` : `${n}d left`}</span>;
};

/**
 * 👤 Providers (roadmap 9.3): agencies and practitioners; open one for its payer enrollments, expiring items, CAQH and
 * the 📋 status checklist. Editors (“Manage credentialing”) add / edit / turn off — never delete.
 */
export default function CredProviders({ data, ctx, user, canEdit, openId, onOpen, onChanged }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('ALL');
  const [clientId, setClientId] = useState('ALL');
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState(null);          // { kind, row?, extra? }
  const clientName = id => ctx.clients.find(c => c.id === id)?.name;
  const payerName = id => ctx.payers.find(p => p.id === id)?.name ?? 'Payer';

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.providers.filter(p => (showOff || p.active !== false) && (kind === 'ALL' || p.kind === kind)
      && (clientId === 'ALL' || p.client_id === clientId)
      && (!q || [p.name, p.npi, p.caqh_id].some(x => (x ?? '').toLowerCase().includes(q))));
  }, [data.providers, query, kind, clientId, showOff]);

  const open = openId != null ? data.providers.find(p => p.id === openId) : null;

  async function toggle(kindName, row) {
    if (await setCredActive(kindName, row, row.active === false, user)) onChanged();
  }

  if (open) {
    const ens = data.enrollments.filter(e => e.provider_id === open.id && (showOff || e.active !== false));
    const xs = data.expirables.filter(x => x.provider_id === open.id && (showOff || x.active !== false));
    const caqhDue = open.caqh_attested_on ? addDays(open.caqh_attested_on, CAQH_DAYS) : null;
    return (
      <>
        <button className="btn-sm" style={{ marginBottom: 12 }} onClick={() => onOpen(null)}>← All providers</button>
        <div className="card mb-16">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">
              {open.kind === 'agency' ? '🏢' : '👤'} {open.name}
              <span className="text-sm text-muted"> · {labelOf(PROVIDER_TYPES, open.provider_type)}{open.npi ? ` · NPI ${open.npi}` : ''}{clientName(open.client_id) ? ` · ${clientName(open.client_id)}` : ''}</span>
              {open.active === false && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Inactive</span>}
            </div>
            <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              <CopyButton value={statusChecklist(open, data, ctx.payers)} label="📋 Copy status checklist" />
              {canEdit && <button className="btn-sm" onClick={() => setEditing({ kind: 'provider', row: open })}>✏️ Edit</button>}
              {canEdit && <button className="btn-sm" onClick={() => toggle('provider', open)}>{open.active === false ? 'Reactivate' : 'Make inactive'}</button>}
            </span>
          </div>
          {open.kind === 'individual' && (
            <div className="row text-sm" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span><span className="text-muted">CAQH ID:</span> {open.caqh_id || '—'}</span>
              <span><span className="text-muted">Last attested:</span> {fmtDate(open.caqh_attested_on)}</span>
              {caqhDue && <span><span className="text-muted">Next due:</span> {fmtDate(caqhDue)} {leftBadge(caqhDue)}</span>}
            </div>
          )}
          {open.notes && <div className="text-sm" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{open.notes}</div>}
        </div>

        <div className="card mb-16">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">🏥 Payer enrollments <span className="text-sm text-muted">· {ens.length}</span></div>
            {canEdit && <button className="btn-sm" onClick={() => setEditing({ kind: 'enrollment', extra: { provider_id: open.id } })}>+ Enrollment</button>}
          </div>
          {ens.length === 0 && <div className="text-sm text-muted">No enrollments recorded.</div>}
          {ens.map(e => (
            <div key={e.id} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)', ...(e.active === false ? { opacity: 0.55 } : {}) }}>
              <span className="bold" style={{ flex: '1 1 180px' }}>{payerName(e.payer_id)}</span>
              <span className={`badge ${statusOf(e.status).badge}`}>{statusOf(e.status).label}</span>
              <span className="text-sm text-muted" style={{ flex: '2 1 260px' }}>
                {[e.submitted_on && `submitted ${fmtDate(e.submitted_on)}`, e.last_followup_on && `last f/u ${fmtDate(e.last_followup_on)}`,
                  e.effective_on && `effective ${fmtDate(e.effective_on)}`, e.payer_provider_id && `ID ${e.payer_provider_id}`,
                  e.rep_name && `rep ${e.rep_name}${e.rep_phone ? ` ${e.rep_phone}` : ''}`].filter(Boolean).join(' · ')}
              </span>
              {e.revalidation_due && <span className="text-sm">Reval {fmtDate(e.revalidation_due)} {leftBadge(e.revalidation_due)}</span>}
              {e.payer_provider_id && <CopyButton value={e.payer_provider_id} label="Copy ID" />}
              {canEdit && <button className="btn-sm" onClick={() => setEditing({ kind: 'enrollment', row: e })} aria-label="Edit">✏️</button>}
              {canEdit && <button className="btn-sm" onClick={() => toggle('enrollment', e)}>{e.active === false ? 'On' : 'Off'}</button>}
            </div>
          ))}
        </div>

        <div className="card mb-16">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">📄 Licenses & certificates <span className="text-sm text-muted">· {xs.length}</span></div>
            {canEdit && <button className="btn-sm" onClick={() => setEditing({ kind: 'expirable', extra: { provider_id: open.id } })}>+ Item</button>}
          </div>
          {xs.length === 0 && <div className="text-sm text-muted">Nothing recorded.</div>}
          {xs.map(x => (
            <div key={x.id} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)', ...(x.active === false ? { opacity: 0.55 } : {}) }}>
              <span className="bold" style={{ flex: '1 1 200px' }}>{labelOf(ITEM_TYPES, x.item_type)}</span>
              <span className="text-sm text-muted" style={{ flex: '2 1 220px' }}>{[x.number, x.issuer].filter(Boolean).join(' · ')}</span>
              <span className="text-sm">Expires {fmtDate(x.expires_on)} {leftBadge(x.expires_on)}</span>
              {canEdit && <button className="btn-sm" onClick={() => setEditing({ kind: 'expirable', row: x })} aria-label="Edit">✏️</button>}
              {canEdit && <button className="btn-sm" onClick={() => toggle('expirable', x)}>{x.active === false ? 'On' : 'Off'}</button>}
            </div>
          ))}
        </div>

        {editing && (
          <CredEditor kind={editing.kind} row={editing.row ?? null} extra={editing.extra} ctx={ctx} user={user}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
        )}
      </>
    );
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="search" style={{ flex: '2 1 200px' }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, NPI or CAQH ID…" aria-label="Search" />
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">
            <option value="ALL">Agencies + practitioners</option>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <select value={clientId} onChange={e => setClientId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))} aria-label="Client">
            <option value="ALL">All clients</option>
            {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {canEdit && (
            <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> Show inactive
            </label>
          )}
          {canEdit && <button className="btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ kind: 'provider' })}>+ Provider</button>}
        </div>
      </div>
      {list.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>{data.providers.length ? 'No providers match.' : 'No providers yet.'}</div>}
      {list.map(p => {
        const ens = data.enrollments.filter(e => e.provider_id === p.id && e.active !== false);
        const approved = ens.filter(e => e.status === 'approved').length;
        return (
          <div key={p.id} className="card mb-16" style={{ cursor: 'pointer', ...(p.active === false ? { opacity: 0.55 } : {}) }} onClick={() => onOpen(p.id)} role="button">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="bold">{p.kind === 'agency' ? '🏢' : '👤'} {p.name}</span>
              <span className="text-sm text-muted">{labelOf(PROVIDER_TYPES, p.provider_type)}{p.npi ? ` · NPI ${p.npi}` : ''}{clientName(p.client_id) ? ` · ${clientName(p.client_id)}` : ''}</span>
              <span className="text-sm" style={{ marginLeft: 'auto' }}>{approved} / {ens.length} payers approved</span>
            </div>
          </div>
        );
      })}
      {editing && (
        <CredEditor kind={editing.kind} row={editing.row ?? null} extra={editing.extra} ctx={ctx} user={user}
          onClose={() => setEditing(null)} onSaved={saved => { setEditing(null); onChanged(); if (editing.kind === 'provider' && !editing.row) onOpen(saved.id); }} />
      )}
    </>
  );
}
