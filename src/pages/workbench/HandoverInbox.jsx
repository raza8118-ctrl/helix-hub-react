import { useState } from 'react';
import { NOTE_FIELDS, itemStatusOf, markRead, pickItem, doneItem, escalateItem } from '../../lib/handover';
import { escRef } from '../../lib/escalations';
import CopyButton from '../../components/shared/CopyButton';
import EscalationEditor from './EscalationEditor';

const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * 📥 For my team (roadmap 7.4): the team's submitted handovers of the last 2 shift dates (not my own).
 * ✓ Read is tracked; carry-over items can be taken, done or escalated.
 */
export default function HandoverInbox({ user, ctx, people, names, handovers, showReaders, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [escalating, setEscalating] = useState(null);   // handover item
  const clientName = id => ctx.clients.find(c => c.id === id)?.name;
  const payerName = id => ctx.payers.find(p => p.id === id)?.name;

  async function run(fn) { setBusy(true); await fn(); setBusy(false); onChanged(); }

  if (!handovers.length) {
    return <div className="card text-muted" style={{ textAlign: 'center' }}>No handovers from your team for today or yesterday yet.</div>;
  }

  return (
    <>
      {handovers.map(h => {
        const read = h.reads.includes(user.emp_id);
        return (
          <div key={h.id} className="card mb-16" style={read ? undefined : { borderLeft: '4px solid var(--primary, #3b82f6)' }}>
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title">
                {names[h.emp_id] ?? h.emp_id} <span className="text-sm text-muted">· {fmtDate(h.shift_date)}{h.team ? ` · ${h.team}` : ''}</span>
              </div>
              {read
                ? <span className="badge badge-green">✓ Read</span>
                : <button className="btn-primary btn-sm" disabled={busy} onClick={() => run(() => markRead(h, user))}>✓ Mark as read</button>}
            </div>
            {NOTE_FIELDS.map(f => h[f.key] && (
              <div key={f.key} style={{ marginBottom: 6 }}>
                <div className="bold text-sm">{f.label}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{h[f.key]}</div>
              </div>
            ))}
            {h.items.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="bold text-sm">Carry over</div>
                {h.items.map(it => {
                  const st = itemStatusOf(it.status);
                  return (
                    <div key={it.id} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                      <span style={{ flex: '2 1 240px' }}>
                        {it.priority === 'urgent' && <span className="badge badge-red" style={{ marginRight: 6 }}>Urgent</span>}
                        {it.what}
                        <span className="text-sm text-muted">
                          {clientName(it.client_id) ? ` · ${clientName(it.client_id)}` : ''}{payerName(it.payer_id) ? ` · ${payerName(it.payer_id)}` : ''}
                        </span>
                      </span>
                      {it.claim_number && <span className="row text-sm" style={{ gap: 4, alignItems: 'center' }}>#{it.claim_number}<CopyButton value={it.claim_number} /></span>}
                      <span className={`badge ${st.badge}`}>{st.label}{it.picked_by ? ` · ${names[it.picked_by] ?? it.picked_by}` : ''}</span>
                      {it.escalation_id && <span className="badge badge-purple">⚑ {escRef(it.escalation_id)}</span>}
                      {it.status === 'open' && <button className="btn-sm" disabled={busy} onClick={() => run(() => pickItem(it, user))}>🙋 I’ll take it</button>}
                      {it.status !== 'done' && (it.status === 'open' || it.picked_by === user.emp_id) && (
                        <button className="btn-sm" disabled={busy} onClick={() => run(() => doneItem(it, user))}>✓ Done</button>
                      )}
                      {it.status !== 'done' && !it.escalation_id && <button className="btn-sm" disabled={busy} onClick={() => setEscalating(it)}>⚑ Escalate</button>}
                    </div>
                  );
                })}
              </div>
            )}
            {showReaders && (
              <div className="text-sm text-muted" style={{ marginTop: 6 }}>
                Read by: {h.reads.length ? h.reads.map(id => names[id] ?? id).join(', ') : 'nobody yet'}
              </div>
            )}
          </div>
        );
      })}

      {escalating && (
        <EscalationEditor row={null} ctx={ctx} people={people} user={user}
          initial={{ title: escalating.what.slice(0, 150), client_id: escalating.client_id, payer_id: escalating.payer_id, claim_number: escalating.claim_number ?? '', severity: escalating.priority === 'urgent' ? 'high' : 'medium' }}
          create={values => escalateItem(escalating, values, user)}
          onClose={() => setEscalating(null)} onSaved={() => { setEscalating(null); onChanged(); }} />
      )}
    </>
  );
}
