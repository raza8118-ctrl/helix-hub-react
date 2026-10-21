import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadPeople } from '../../lib/qa';
import { loadQueries, clearOldQueries, isOpen, chaseDue, isOverdue, queryRef } from '../../lib/clientQueries';
import { alertDialog } from '../../components/shared/Dialog';
import QueryEditor from './QueryEditor';
import QueryList from './QueryList';
import QueryAging from './QueryAging';
import { peekRecord, clearRecord } from '../../lib/navigate';

/**
 * 💬 Client Queries (roadmap 7.3): every question we send a client — logged, chased every 3 working days until
 * answered, with aging per client. Minimum fields only; texts are checked for patient details; claim # wiped 90 days
 * after closing. Everyone sees all queries and changes their own; “Manage client queries” changes anyone's.
 */
export default function ClientQueries({ user }) {
  const [queries, setQueries] = useState(undefined);   // undefined = loading, null = not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [people, setPeople] = useState([]);
  const [tab, setTab] = useState(() => peekRecord('wb_queries')?.tab ?? 'mine');   // 10.1: from global search
  const [initialQuery] = useState(() => peekRecord('wb_queries')?.query ?? '');
  const [adding, setAdding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    clearRecord('wb_queries');
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadPeople().then(p => { if (alive) setPeople(p); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let list = await loadQueries();
      // Claim # wiped 90 days after a query is closed (done by whoever opens the page)
      if (list && await clearOldQueries(user)) list = await loadQueries();
      if (alive) setQueries(list);
    })();
    return () => { alive = false; };
  }, [user, reloadKey]);

  const names = useMemo(() => Object.fromEntries(people.map(p => [p.emp_id, p.name ?? p.emp_id])), [people]);
  const mineOpen = (queries ?? []).filter(q => q.owner_emp_id === user.emp_id && isOpen(q));
  const attention = mineOpen.filter(q => chaseDue(q) || isOverdue(q)).length;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">💬 Client Queries</div>
          <div className="page-subtitle">Questions sent to clients — chased until answered, with aging per client.</div>
        </div>
        {queries && <button className="btn-primary" onClick={() => setAdding(true)}>+ New query</button>}
      </div>

      {queries === undefined && <div className="card text-muted">Loading…</div>}
      {queries === null && (
        <div className="card text-muted">
          Client Queries aren’t set up yet. An admin needs to run the client query database update
          (<code>20261021o_client_queries.sql</code>) in Supabase.
        </div>
      )}

      {queries && (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              ['mine', `🙋 My queries (${mineOpen.length}${attention ? ` · ${attention} to chase` : ''})`],
              ['all', '📋 All queries'],
              ['aging', '📊 Aging'],
            ].map(([id, label]) => (
              <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {(tab === 'mine' || tab === 'all') && (
            <QueryList key={tab} mode={tab} initialQuery={tab === 'all' ? initialQuery : ''} queries={queries} ctx={ctx} people={people} names={names} user={user} onChanged={reload} />
          )}
          {tab === 'aging' && <QueryAging queries={queries} ctx={ctx} names={names} />}
        </>
      )}

      {adding && (
        <QueryEditor row={null} ctx={ctx} people={people.length ? people : [{ emp_id: user.emp_id, name: user.name }]} user={user}
          onClose={() => setAdding(false)}
          onSaved={q => {
            setAdding(false); reload();
            alertDialog({ title: `Logged as ${queryRef(q.id)}`, message: `Quote ${queryRef(q.id)} when you write to the client.`, tone: 'success' });
          }} />
      )}
    </div>
  );
}
