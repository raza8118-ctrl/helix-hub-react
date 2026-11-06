import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadPeople, scopePeople } from '../../lib/qa';
import { handoverReady, loadHandovers, teamDates, clearOldItems } from '../../lib/handover';
import { loadEscalations, loadEscalatedQueries, clearOldEscalations, canManageEsc, isOpenEsc } from '../../lib/escalations';
import HandoverForm from './HandoverForm';
import HandoverInbox from './HandoverInbox';
import EscalationList from './EscalationList';
import HandoverOverview from './HandoverOverview';
import { peekRecord, clearRecord } from '../../lib/navigate';
import { Button } from '../../components/ui';

/**
 * 🔁 Handover & Escalations (roadmap 7.4): end-of-shift handover per person (read by the team next shift, carry-over
 * items taken / done / escalated) and an escalation tracker with history and overview. Minimum fields only; all text
 * is checked for patient details; claim # wiped 90 days after done / closed.
 */
export default function HandoverEscalations({ user }) {
  const manager = canManageEsc(user);
  const [ready, setReady] = useState(undefined);       // undefined = checking, false = not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [users, setUsers] = useState([]);
  const [team, setTeam] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [queries, setQueries] = useState([]);
  const [tab, setTab] = useState(() => peekRecord('wb_handover')?.tab ?? 'mine');   // 10.1: from global search
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    clearRecord('wb_handover');
    handoverReady().then(ok => { if (alive) setReady(ok); });
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadPeople().then(p => { if (alive) setUsers(p); });
    return () => { alive = false; };
  }, []);

  // My team: same team (supervisors: + supervisees; admins / managers / QA: everyone) — never myself
  const scoped = useMemo(() => scopePeople(user, users), [user, users]);
  const teamIds = useMemo(() => scoped.map(p => p.emp_id), [scoped]);
  useEffect(() => {
    let alive = true;
    if (!ready) return undefined;
    (async () => {
      await Promise.all([clearOldItems(user), clearOldEscalations(user)]);   // claim # wiped 90 days after done / closed
      const dates = teamDates();
      const [h, e, q] = await Promise.all([loadHandovers(dates[dates.length - 1], dates[0], teamIds), loadEscalations(), loadEscalatedQueries()]);
      if (!alive) return;
      setTeam(h); setEscalations(e ?? []); setQueries(q);
    })();
    return () => { alive = false; };
  }, [ready, user, teamIds, reloadKey]);

  const names = useMemo(() => Object.fromEntries(users.map(u => [u.emp_id, u.name ?? u.emp_id])), [users]);
  const unread = team.filter(h => !h.reads.includes(user.emp_id)).length;
  const assigned = escalations.filter(e => e.assigned_to === user.emp_id && isOpenEsc(e)).length;
  const others = users.filter(u => u.emp_id !== user.emp_id);

  // Intro (the page title is in the top bar)
  const header = (
    <div className="fg-bar">
      <span className="fg-date">End-of-shift handover for the next shift, and issues escalated until they are resolved.</span>
    </div>
  );
  if (ready === undefined) return <div className="fg-page wl-page">{header}<div className="card text-muted">Loading…</div></div>;
  if (!ready) {
    return (
      <div className="fg-page wl-page">{header}
        <div className="card text-muted">
          Handover & Escalations aren’t set up yet. An admin needs to run the database update
          (<code>20261021p_handover_escalations.sql</code>) in Supabase.
        </div>
      </div>
    );
  }

  const tabs = [
    ['mine', '📝 My handover'],
    ['team', `📥 For my team${unread ? ` (${unread})` : ''}`],
    ['esc', `⚑ Escalations${assigned ? ` (${assigned})` : ''}`],
    ...(manager ? [['overview', '📊 Overview']] : []),
  ];

  return (
    <div className="fg-page wl-page">
      {header}
      <div className="fg-choices wl-tabs" role="group" aria-label="Handover views">
        {tabs.map(([id, label]) => (
          <Button key={id} size="sm" active={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Button>
        ))}
      </div>
      {tab === 'mine' && <HandoverForm user={user} ctx={ctx} names={names} onSaved={reload} />}
      {tab === 'team' && <HandoverInbox user={user} ctx={ctx} people={others} names={names} handovers={team} showReaders={manager} onChanged={reload} />}
      {tab === 'esc' && <EscalationList escalations={escalations} queries={queries} ctx={ctx} people={others} names={names} user={user} onChanged={reload} />}
      {tab === 'overview' && manager && <HandoverOverview people={scoped} escalations={escalations} ctx={ctx} names={names} />}
    </div>
  );
}
