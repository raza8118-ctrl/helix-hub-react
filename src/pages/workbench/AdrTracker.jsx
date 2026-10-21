import { useState } from 'react';
import { ADR_WARN_DAYS, itemRef, isDone, daysLeft, waitingDays, setItemStatus } from '../../lib/medicareTrackers';
import { addQuery, addWorkdays, queryRef, CHASE_EVERY_WORKDAYS } from '../../lib/clientQueries';
import { today } from '../../lib/helpers';
import { alertDialog } from '../../components/shared/Dialog';
import MedicareTrackerList from './MedicareTrackerList';
import EscalationEditor from './EscalationEditor';

/**
 * 📄 ADR tracker (roadmap 7.5): Additional Documentation Requests from the MAC — response due (letter + 45 days),
 * records from the client, submission, decision. 📨 Ask client for records → Client Query (7.3); ⚑ Escalate → 7.4.
 */
export default function AdrTracker({ items, ctx, people, names, user, onChanged }) {
  const [escalating, setEscalating] = useState(null);
  const [busy, setBusy] = useState(false);

  async function askClient(a) {
    setBusy(true);
    const q = await addQuery({
      client_id: a.client_id, team: 'AR', category: 'documentation', priority: 'urgent', payer_id: a.payer_id,
      claim_number: a.claim_number ?? '', asked_via: 'email', asked_on: today(), expected_on: addWorkdays(today(), CHASE_EVERY_WORKDAYS),
      contact_name: '', owner_emp_id: user.emp_id,
      question: `Please send the complete medical records for Medicare ADR ${itemRef('adr', a.id)} so we can respond to the MAC before the due date.`,
    }, user);
    if (q && a.status === 'received') await setItemStatus('adr', a, 'requested', `Asked the client (${queryRef(q.id)})`, user);
    setBusy(false);
    if (!q) return alertDialog({ title: 'Could not create the query', message: 'Client Queries may not be set up yet (step 7.3 database update).', tone: 'warning' });
    alertDialog({ title: `Client query ${queryRef(q.id)} created`, message: 'You can chase it from 💬 Client Queries.', tone: 'success' });
    onChanged();
  }

  const badges = a => {
    if (isDone('adr', a)) return null;
    const left = daysLeft(a);
    const wait = waitingDays(a);
    return (
      <>
        {left != null && left < 0 && <span className="badge badge-red">Overdue {-left}d</span>}
        {left != null && left >= 0 && left <= ADR_WARN_DAYS && <span className="badge badge-yellow">Due in {left}d</span>}
        {left != null && left > ADR_WARN_DAYS && <span className="text-sm text-muted">due in {left}d</span>}
        {wait != null && wait > 0 && <span className="badge badge-gray">Waiting on client {wait}d</span>}
      </>
    );
  };
  const actions = a => !isDone('adr', a) && (
    <>
      {['received', 'requested'].includes(a.status) && <button className="btn-sm" disabled={busy} onClick={() => askClient(a)}>📨 Ask client for records</button>}
      <button className="btn-sm" disabled={busy} onClick={() => setEscalating(a)}>⚑ Escalate</button>
    </>
  );

  return (
    <>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>
        Response due = ADR letter date + 45 days by default — check current CMS rules and the letter itself.
      </p>
      <MedicareTrackerList kind="adr" items={items} ctx={ctx} people={people} names={names} user={user} onChanged={onChanged}
        badges={badges} actions={actions} sortKey={a => daysLeft(a) ?? 9999} />
      {escalating && (
        <EscalationEditor row={null} ctx={ctx} people={people} user={user}
          initial={{ title: `Medicare ADR ${itemRef('adr', escalating.id)} needs help`, type: 'claim_stuck', severity: (daysLeft(escalating) ?? 99) <= ADR_WARN_DAYS ? 'high' : 'medium',
            client_id: escalating.client_id, payer_id: escalating.payer_id, claim_number: escalating.claim_number ?? '' }}
          onClose={() => setEscalating(null)}
          onSaved={() => { setEscalating(null); alertDialog({ title: 'Escalation raised', message: 'Track it in 🔁 Handover & Escalations.', tone: 'success' }); }} />
      )}
    </>
  );
}
