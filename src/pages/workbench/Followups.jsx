import { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/supabase';
import {
  BUCKETS, bucketOf, snoozeOptions, followupsReady, loadMyFollowups, markDone, snooze, clearOldReminders, teamCounts,
  notifySupported, notifyEnabled, setNotify,
} from '../../lib/followups';
import { ITEM_STATUSES } from '../../lib/worklist';
import { startClaimNote } from '../../lib/claimNotes';
import { fmtUS } from '../../lib/deadlines';
import ReminderModal from './ReminderModal';
import CopyButton from '../../components/shared/CopyButton';

const cell = { padding: '4px 6px', borderBottom: '1px solid var(--border)' };

/** One follow-up line: what, claim #, client, due date and the actions (done / snooze / note). */
function FollowupRow({ f, clientName, onDone, onSnooze }) {
  const [snoozeTo, setSnoozeTo] = useState('');
  const [doneAs, setDoneAs] = useState('followup');
  const options = snoozeOptions();
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
      <span className={`badge ${f.kind === 'worklist' ? 'badge-blue' : 'badge-gray'}`}>{f.kind === 'worklist' ? '📋 Worklist' : '⏰ Reminder'}</span>
      <span className="bold">{f.what}</span>
      {f.claim_number && <span>Claim {f.claim_number} <CopyButton value={f.claim_number} /></span>}
      {clientName && <span className="text-sm text-muted">{clientName}</span>}
      <span className="text-sm" style={{ color: bucketOf(f.due) === 'overdue' ? 'var(--danger)' : undefined }}>due {fmtUS(f.due)}</span>
      <span className="row" style={{ gap: 4, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
        {f.kind === 'worklist' && (
          <select value={doneAs} onChange={e => setDoneAs(e.target.value)} title="Status when done" style={{ maxWidth: 190 }}>
            {ITEM_STATUSES.filter(s => s.value !== 'new').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <button className="btn-sm" onClick={() => onDone(f, doneAs)}>✓ Done</button>
        <select value={snoozeTo} onChange={e => { const v = e.target.value; setSnoozeTo(''); if (v) onSnooze(f, v); }} title="Snooze" style={{ maxWidth: 130 }}>
          <option value="">💤 Snooze…</option>
          {options.map(o => <option key={o.label} value={o.date}>{o.label}</option>)}
        </select>
        <input type="date" title="Snooze to a date" onChange={e => e.target.value && onSnooze(f, e.target.value)} style={{ maxWidth: 140 }} />
        <button className="btn-sm" onClick={() => startClaimNote({ client_id: f.client_id, payer_id: f.payer_id })}>📝 Note</button>
      </span>
    </div>
  );
}

/**
 * ⏰ Follow-ups (roadmap 6.5): my worklist follow-up dates + personal reminders, by date or grouped by payer,
 * with done / snooze / write note; team overview for people who manage worklists. No free text, no patient details.
 */
export default function Followups({ user, ctx, people, canManage }) {
  const [ready, setReady] = useState(undefined);
  const [items, setItems] = useState(null);
  const [groupBy, setGroupBy] = useState('date');
  const [phones, setPhones] = useState({});
  const [team, setTeam] = useState(null);
  const [adding, setAdding] = useState(false);
  const [notifyOn, setNotifyOn] = useState(() => notifyEnabled());
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  const empId = user.emp_id;
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await followupsReady();
      if (!alive) return;
      setReady(ok);
      if (ok) await clearOldReminders(empId, user);
      const list = await loadMyFollowups(empId);
      if (alive) setItems(list);
      // Claims phone numbers for the payers involved
      const ids = [...new Set(list.map(f => f.payer_id).filter(Boolean))];
      if (ids.length) {
        const { data } = await db('payer_contacts').select('payer_id,department,phone,active').in('payer_id', ids);
        const map = {};
        for (const c of (data ?? []).filter(x => x.active !== false && x.phone)) {
          if (!map[c.payer_id] || c.department === 'claims') map[c.payer_id] = c.phone;
        }
        if (alive) setPhones(map);
      }
    })();
    return () => { alive = false; };
  }, [empId, user, reloadKey]);

  const peopleIds = useMemo(() => people.map(p => p.emp_id), [people]);
  useEffect(() => {
    let alive = true;
    if (canManage && peopleIds.length) teamCounts(peopleIds).then(c => { if (alive) setTeam(c); });
    return () => { alive = false; };
  }, [canManage, peopleIds, reloadKey]);

  const payerName = f => f.payer_name ?? ctx.payers.find(p => p.id === f.payer_id)?.name ?? 'No payer';
  const clientName = id => ctx.clients.find(c => c.id === id)?.name ?? '';
  const counts = Object.fromEntries(BUCKETS.map(b => [b.value, (items ?? []).filter(f => bucketOf(f.due) === b.value).length]));

  async function done(f, as) { if (await markDone(f, user, as)) reload(); }
  async function doSnooze(f, date) { if (await snooze(f, date, user)) reload(); }

  async function downloadTeam() {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(people.filter(p => team?.[p.emp_id]).map(p => ({
      Person: p.name ?? p.emp_id, Team: p.team ?? '', Overdue: team[p.emp_id].overdue, 'Due today': team[p.emp_id].today, 'Done today': team[p.emp_id].doneToday,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Follow-ups');
    XLSX.writeFile(wb, `follow-ups-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (items === null) return <div className="card text-muted">Loading follow-ups…</div>;
  const groups = groupBy === 'payer'
    ? Object.entries(items.reduce((acc, f) => { (acc[payerName(f)] ??= []).push(f); return acc; }, {}))
      .sort((a, b) => b[1].length - a[1].length)
    : BUCKETS.map(b => [b.value, items.filter(f => bucketOf(f.due) === b.value)]).filter(([, list]) => list.length);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 12 }}>
        {BUCKETS.map(b => (
          <div key={b.value} className="stat-card"><div className="stat-label">{b.icon} {b.label}</div><div className="stat-value">{counts[b.value]}</div></div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[['date', 'By date'], ['payer', 'By payer']].map(([v, label]) => (
          <button key={v} className={groupBy === v ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={groupBy === v} onClick={() => setGroupBy(v)}>{label}</button>
        ))}
        {notifySupported() && (
          <label className="row text-sm" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }} title="Shows a desktop notification (count only) while Helix Hub is open">
            <input type="checkbox" checked={notifyOn} onChange={async e => setNotifyOn(await setNotify(e.target.checked))} /> 🔔 Remind me on this computer
          </label>
        )}
        {ready && <button className="btn-sm" onClick={() => setAdding(true)}>+ Reminder</button>}
      </div>
      {ready === false && (
        <div className="card mb-16 text-sm text-muted">
          Personal reminders need the follow-ups database update (<code>20261021k_followups.sql</code>). Worklist follow-ups are shown below.
        </div>
      )}

      {items.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>Nothing to follow up. 🎉</div>}
      {groups.map(([key, list]) => {
        const b = BUCKETS.find(x => x.value === key);
        const payerId = groupBy === 'payer' ? list.find(f => f.payer_id)?.payer_id : null;
        return (
          <div key={key} className="card mb-16">
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="card-title">{b ? `${b.icon} ${b.label}` : `🏢 ${key}`}</span>
              <span className="text-sm text-muted">{list.length}</span>
              {payerId && phones[payerId] && <span className="text-sm">📞 {phones[payerId]} <CopyButton value={phones[payerId]} /></span>}
            </div>
            {list.map(f => (
              <div key={f.key}>
                {groupBy === 'date' && <div className="text-sm text-muted" style={{ marginTop: 4 }}>{payerName(f)}</div>}
                <FollowupRow f={f} clientName={clientName(f.client_id)} onDone={done} onSnooze={doSnooze} />
              </div>
            ))}
          </div>
        );
      })}

      {canManage && team && people.some(p => team[p.emp_id] && (team[p.emp_id].overdue || team[p.emp_id].today || team[p.emp_id].doneToday)) && (
        <div className="card mb-16" style={{ overflowX: 'auto' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className="card-title">👥 Team follow-ups</span>
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={downloadTeam}>⬇ Excel</button>
          </div>
          <table className="text-sm" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left' }}>{['Person', 'Overdue', 'Due today', 'Done today'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {people.filter(p => team[p.emp_id] && (team[p.emp_id].overdue || team[p.emp_id].today || team[p.emp_id].doneToday)).map(p => (
                <tr key={p.emp_id}>
                  <td style={cell}>{p.name ?? p.emp_id}</td>
                  <td style={cell}>{team[p.emp_id].overdue ? <span className="badge badge-red">{team[p.emp_id].overdue}</span> : '—'}</td>
                  <td style={cell}>{team[p.emp_id].today || '—'}</td>
                  <td style={cell}>{team[p.emp_id].doneToday || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <ReminderModal ctx={ctx} user={user} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}
