import { useState, useMemo } from 'react';
import { BANDS, ITEM_STATUSES, isDone, prioritise, updateItem } from '../../lib/worklist';
import { startClaimNote } from '../../lib/claimNotes';
import { today } from '../../lib/helpers';
import { fmtUS } from '../../lib/deadlines';
import CopyButton from '../../components/shared/CopyButton';

const usd = n => (n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const PAGE = 100;

/**
 * My worklist (roadmap 6.4): the claims assigned to me, highest priority first, follow-ups due / overdue on top.
 * Setting a status (other than “Not worked yet”) counts the claim as worked today for the Daily Report suggestion.
 */
export default function MyWorklist({ user, worklists, items, onItemChanged }) {
  const [showDone, setShowDone] = useState(false);
  const [listF, setListF] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [saving, setSaving] = useState(null);

  const byList = useMemo(() => Object.fromEntries(worklists.map(w => [w.id, w])), [worklists]);
  // Priority is worked out per worklist (each has its own weights / priority payers), then merged
  const ranked = useMemo(() => {
    const groups = {};
    items.forEach(i => { (groups[i.worklist_id] ??= []).push(i); });
    return Object.entries(groups)
      .flatMap(([id, list]) => prioritise(list, { weights: byList[id]?.weights, starred: byList[id]?.starred_payers }))
      .sort((a, b) => b.score - a.score);
  }, [items, byList]);

  const day = today();
  const open = ranked.filter(i => !isDone(i.status));
  const dueNow = open.filter(i => i.follow_up && i.follow_up <= day);
  const shown = ranked
    .filter(i => listF === 'ALL' || String(i.worklist_id) === listF)
    .filter(i => showDone || !isDone(i.status))
    .sort((a, b) => (b.follow_up && b.follow_up <= day) - (a.follow_up && a.follow_up <= day));
  const workedToday = items.filter(i => i.worked_by === user.emp_id && i.worked_at?.slice(0, 10) === day).length;

  async function change(item, patch) {
    setSaving(item.id);
    const row = await updateItem(item, patch, user);
    setSaving(null);
    if (row) onItemChanged(row);
  }

  if (!items.length) {
    return <div className="card text-muted" style={{ textAlign: 'center' }}>No claims are assigned to you yet.</div>;
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
        {[['Open claims', open.length], ['Worked today', workedToday], ['Follow-ups due', dueNow.length], ['High priority', open.filter(i => i.band === 'high').length]].map(([label, v]) => (
          <div key={label} className="stat-card"><div className="stat-label">{label}</div><div className="stat-value">{v}</div></div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <select value={listF} onChange={e => setListF(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="ALL">All my worklists</option>
          {worklists.filter(w => items.some(i => i.worklist_id === w.id)).map(w => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
        </select>
        <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show finished claims
        </label>
      </div>

      {shown.slice(0, limit).map(i => {
        const due = i.follow_up && i.follow_up <= day && !isDone(i.status);
        return (
          <div key={i.id} className="card mb-16" style={{ borderLeft: `4px solid ${due ? 'var(--danger)' : i.band === 'high' ? 'var(--danger)' : i.band === 'medium' ? 'var(--warning)' : 'var(--success)'}`, opacity: isDone(i.status) ? 0.65 : 1 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`badge ${BANDS[i.band].badge}`}>{BANDS[i.band].icon} {BANDS[i.band].label}</span>
              <span className="bold">{i.claim_number ?? <span className="text-muted">cleared</span>}</span>
              {i.claim_number && <CopyButton value={i.claim_number} />}
              <span>{i.payer_name ?? ''}</span>
              <span className="text-sm text-muted">DOS {fmtUS(i.dos_from)}{i.dos_to && i.dos_to !== i.dos_from ? `–${fmtUS(i.dos_to)}` : ''}</span>
              <span className="bold">{usd(i.balance)}</span>
              {due && <span className="badge badge-red">Follow-up {i.follow_up < day ? 'overdue' : 'due today'}</span>}
            </div>
            <div className="text-sm text-muted" style={{ marginTop: 2 }}>{i.reason} · {byList[i.worklist_id]?.name}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
              <select value={i.status} disabled={saving === i.id} onChange={e => change(i, { status: e.target.value })} style={{ maxWidth: 240 }}>
                {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <label className="row text-sm" style={{ gap: 4 }}>Follow-up
                <input type="date" value={i.follow_up ?? ''} disabled={saving === i.id} onChange={e => change(i, { follow_up: e.target.value || null })} />
              </label>
              <button className="btn-sm" onClick={() => startClaimNote({ client_id: i.client_id, payer_id: i.payer_id })}>📝 Write note</button>
              {saving === i.id && <span className="text-sm text-muted">Saving…</span>}
            </div>
          </div>
        );
      })}
      {shown.length > limit && <button className="btn-sm" onClick={() => setLimit(l => l + PAGE)}>Show more ({shown.length - limit} left)</button>}
    </div>
  );
}
