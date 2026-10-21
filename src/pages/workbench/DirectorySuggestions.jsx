import { useState, useMemo } from 'react';
import { SUGGESTION_SECTIONS, showValue, rejectSuggestion, canApproveSuggestions } from '../../lib/payerSuggestions';
import { promptDialog } from '../../components/shared/Dialog';
import SuggestionEditor from './SuggestionEditor';

const fmtDate = d => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const STATUS = { pending: ['Waiting for review', 'badge-yellow'], approved: ['Approved', 'badge-green'], rejected: ['Rejected', 'badge-gray'] };

/**
 * 🛠 Directory suggestions (roadmap 8.3): Payer Directory changes suggested from bulletins, grouped by payer, with the
 * bulletin's own words; “Edit Payer Directory” holders review → ✓ Approve (written + verified) or ✕ Reject.
 */
export default function DirectorySuggestions({ suggestions, bulletins, ctx, user, onChanged, onOpenPdf }) {
  const canApprove = canApproveSuggestions(user);
  const [status, setStatus] = useState('pending');
  const [reviewing, setReviewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const bulletinOf = id => bulletins.find(b => b.id === id);

  const groups = useMemo(() => {
    const by = new Map();
    for (const s of suggestions) {
      if (status !== 'all' && s.status !== status) continue;
      const name = s.payer_id ? ctx.payers.find(p => p.id === s.payer_id)?.name ?? s.payer_name : `${s.payer_name || 'Payer not named'} (not matched)`;
      const key = s.payer_id ? `p${s.payer_id}` : `n${name}`;
      if (!by.has(key)) by.set(key, { key, name, list: [] });
      by.get(key).list.push(s);
    }
    return [...by.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [suggestions, status, ctx.payers]);

  async function reject(s) {
    const reason = await promptDialog({ title: 'Reject this suggestion?', placeholder: 'Why (optional)' });
    if (reason === null) return;
    setBusy(true);
    if (await rejectSuggestion(s, reason, user)) onChanged();
    setBusy(false);
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
            <option value="pending">Waiting for review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <span className="text-sm text-muted">
            Suggested from bulletins — nothing changes in the Payer Directory until it is approved{canApprove ? '' : ' by someone who can edit it'}.
          </span>
        </div>
      </div>

      {groups.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>No suggestions here. Use “💡 Suggest directory changes” on a bulletin.</div>}

      {groups.map(g => (
        <div key={g.key} className="card mb-16">
          <div className="card-header"><div className="card-title">{g.name} <span className="text-sm text-muted">· {g.list.length}</span></div></div>
          {g.list.map(s => {
            const t = SUGGESTION_SECTIONS[s.section];
            const b = bulletinOf(s.bulletin_id);
            const [label, badge] = STATUS[s.status] ?? STATUS.pending;
            const keys = Object.keys(s.proposed ?? {});
            return (
              <div key={s.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="bold">{t.icon} {t.title}</span>
                  <span className={`badge ${s.action === 'update' ? 'badge-purple' : 'badge-blue'}`}>{s.action === 'update' ? 'Change' : 'Add new'}</span>
                  <span className={`badge ${badge}`}>{label}</span>
                  <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>{fmtDate(s.created_at)}</span>
                </div>
                <div className="text-sm" style={{ marginTop: 4 }}>
                  {keys.map(k => {
                    const cur = s.current?.[k];
                    const changed = s.current && String(cur ?? '') !== String(s.proposed[k] ?? '');
                    return (
                      <div key={k}>
                        <span className="text-muted">{t.fields.find(f => f.key === k)?.label ?? k}:</span>{' '}
                        {changed && <><s className="text-muted">{showValue(s.section, k, cur)}</s> → </>}
                        <b>{showValue(s.section, k, s.proposed[k])}</b>
                      </div>
                    );
                  })}
                </div>
                {s.evidence && <div className="text-sm text-muted" style={{ marginTop: 4, fontStyle: 'italic' }}>“{s.evidence}”</div>}
                <div className="row text-sm" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                  {b && <span className="text-muted">From “{b.title}”{s.source_page ? `, page ${s.source_page}` : ''}</span>}
                  {b?.file_path && <button className="btn-sm" onClick={() => onOpenPdf(b)}>Open PDF ↗</button>}
                  {s.status === 'rejected' && s.reason && <span className="text-muted">Reason: {s.reason}</span>}
                  {canApprove && s.status === 'pending' && (
                    <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                      <button className="btn-sm" disabled={busy} onClick={() => reject(s)}>✕ Reject</button>
                      <button className="btn-primary btn-sm" disabled={busy} onClick={() => setReviewing(s)}>Review & approve</button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {reviewing && (
        <SuggestionEditor suggestion={reviewing} bulletin={bulletinOf(reviewing.bulletin_id)} ctx={ctx} user={user}
          onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); onChanged(); }} />
      )}
    </>
  );
}
