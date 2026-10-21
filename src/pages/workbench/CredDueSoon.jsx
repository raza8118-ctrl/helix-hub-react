import { useState } from 'react';
import { BANDS, bandOf, patchCred } from '../../lib/credentialing';
import { addReminder } from '../../lib/followups';
import { today } from '../../lib/helpers';
import CredEditor from './CredEditor';

const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const TYPE_ICONS = { caqh: '🪪', reval: '🔁', expirable: '📄', stuck: '⏳' };

/**
 * ⏰ Due soon (roadmap 9.3): CAQH re-attestations, revalidations, expiring licenses / certificates and enrollments
 * stuck in process — overdue first, then within 30 / 60 / 90 days. Quick “done” actions for editors; anyone can add
 * an item to their own follow-ups.
 */
export default function CredDueSoon({ items, ctx, user, canEdit, onChanged, onOpenProvider }) {
  const [editing, setEditing] = useState(null);         // { kind, row }
  const [busy, setBusy] = useState(null);
  const [added, setAdded] = useState(() => new Set());

  async function quick(item, patch) {
    setBusy(item.key);
    if (await patchCred(item.record.kind, item.record.row, patch, user)) onChanged();
    setBusy(null);
  }
  async function remind(item) {
    setBusy(item.key);
    const ok = await addReminder({
      empId: user.emp_id, clientId: item.provider.client_id ?? null, payerId: item.record.row.payer_id ?? null, claimNumber: '',
      action: 'credentialing', dueDate: item.due > today() ? item.due : today(),
    }, user);
    if (ok) setAdded(s => new Set(s).add(item.key));
    setBusy(null);
  }

  if (!items.length) return <div className="card text-muted" style={{ textAlign: 'center' }}>Nothing due in the next 90 days. 🎉</div>;

  return (
    <>
      {BANDS.map(b => {
        const list = items.filter(i => bandOf(i.days) === b.key);
        if (!list.length) return null;
        return (
          <div key={b.key} className="card mb-16">
            <div className="card-header"><div className="card-title">{b.icon} {b.label} <span className="text-sm text-muted">· {list.length}</span></div></div>
            {list.map(i => (
              <div key={i.key} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <span>{TYPE_ICONS[i.type]}</span>
                <span style={{ flex: '2 1 240px' }}>
                  <b>{i.what}</b>
                  <div className="text-sm text-muted">
                    {i.provider.name} · due {fmtDate(i.due)} · {i.days < 0 ? <span style={{ color: 'var(--danger)' }}>{-i.days} days overdue</span> : `${i.days} days left`}
                  </div>
                </span>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {canEdit && i.type === 'caqh' && <button className="btn-sm" disabled={busy === i.key} onClick={() => quick(i, { caqh_attested_on: today() })}>✓ Attested today</button>}
                  {canEdit && i.type === 'stuck' && <button className="btn-sm" disabled={busy === i.key} onClick={() => quick(i, { last_followup_on: today() })}>✓ Followed up today</button>}
                  {canEdit && (i.type === 'reval' || i.type === 'expirable') && <button className="btn-sm" onClick={() => setEditing(i.record)}>Update date</button>}
                  {added.has(i.key)
                    ? <span className="badge badge-green">⏰ Added</span>
                    : <button className="btn-sm" disabled={busy === i.key} onClick={() => remind(i)}>⏰ Add to my follow-ups</button>}
                  <button className="btn-sm" onClick={() => onOpenProvider(i.provider)}>Open ›</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
      {editing && (
        <CredEditor kind={editing.kind} row={editing.row} ctx={ctx} user={user}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </>
  );
}
