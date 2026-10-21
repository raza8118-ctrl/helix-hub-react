import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import {
  qaReady, canAudit, canManageQa, loadQaSetup, loadPeople, loadAudits, loadMyAudits, scopePeople, clearOldAudits,
  qaStatusOf, setAuditActive,
} from '../../lib/qa';
import { confirmDialog } from '../../components/shared/Dialog';
import QaAuditForm from './QaAuditForm';
import QaSampling from './QaSampling';
import MyQaAudits, { ResolveModal } from './MyQaAudits';
import QaResults from './QaResults';
import QaScorecards from './QaScorecards';
import ErrorLibrary from './ErrorLibrary';
import { loadMistakes, seenCounts } from '../../lib/mistakes';

const fmtDate = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', verticalAlign: 'top' };

/**
 * ✅ QA Audits (roadmap 7.1): scorecards with error categories linked to SOPs, audits sent to the agent to acknowledge
 * or dispute, sampling from the Smart Worklist, and results. The Daily Report quality % and Quality Monitor are untouched.
 * Auditors: QA flag + “Do QA audits” (supervisors for their own team only).
 */
export default function QaAudits({ user }) {
  const auditor = canAudit(user);
  const manager = canManageQa(user);
  const [ready, setReady] = useState(undefined);       // undefined = checking, false = not set up
  const [setup, setSetup] = useState({ categories: [], scorecards: [], checkpoints: [] });
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [users, setUsers] = useState([]);
  const [mine, setMine] = useState([]);
  const [all, setAll] = useState([]);
  const [mistakes, setMistakes] = useState([]);         // 7.2 error library; null = not set up
  const [seen, setSeen] = useState({});
  const [tab, setTab] = useState(auditor ? 'audit' : 'mine');
  const [editing, setEditing] = useState(null);        // audit being filled in ({} = new)
  const [resolving, setResolving] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  const empId = user.emp_id;
  useEffect(() => {
    let alive = true;
    qaReady().then(ok => { if (alive) setReady(ok); });
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadPeople().then(p => { if (alive) setUsers(p); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!ready) return undefined;
    (async () => {
      if (auditor) await clearOldAudits(user);   // claim # wiped 90 days after an audit is closed
      const [s, m, a, lib, counts] = await Promise.all([loadQaSetup(), loadMyAudits(empId), auditor ? loadAudits() : Promise.resolve([]), loadMistakes(), seenCounts()]);
      if (!alive) return;
      setSetup(s); setMine(m); setAll(a); setMistakes(lib); setSeen(counts);
    })();
    return () => { alive = false; };
  }, [ready, auditor, empId, user, reloadKey]);

  const people = useMemo(() => scopePeople(user, users), [user, users]);
  const names = useMemo(() => Object.fromEntries(users.map(u => [u.emp_id, u.name ?? u.emp_id])), [users]);
  const scoped = useMemo(() => {
    const ids = new Set(people.map(p => p.emp_id));
    return all.filter(a => ids.has(a.agent_emp_id));
  }, [all, people]);

  const waiting = mine.filter(a => a.status === 'sent').length;
  const tabs = [
    ...(auditor ? [['audit', '🔍 Audit']] : []),
    ['mine', `🙋 My audits${waiting ? ` (${waiting})` : ''}`],
    ['library', '📖 Mistakes & fixes'],   // 7.2
    ...(auditor ? [['sampling', '🎲 Sampling'], ['results', '📊 Results']] : []),
    ...(manager ? [['setup', '🗂 Scorecards & categories']] : []),
  ];

  const header = (
    <div className="page-header">
      <div>
        <div className="page-title">✅ QA Audits</div>
        <div className="page-subtitle">Scorecards, error categories linked to SOPs, and audits the agent acknowledges.</div>
      </div>
    </div>
  );
  if (ready === undefined) return <div style={{ maxWidth: 1100, margin: '0 auto' }}>{header}<div className="card text-muted">Loading…</div></div>;
  if (!ready) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>{header}
        <div className="card text-muted">
          QA Audits aren’t set up yet. An admin needs to run the QA database update (<code>20261021m_qa_audits.sql</code>) in Supabase.
        </div>
      </div>
    );
  }

  const cardName = id => setup.scorecards.find(c => c.id === id)?.name ?? '—';
  const queued = scoped.filter(a => a.status === 'queued');
  const drafts = scoped.filter(a => a.status === 'draft' && a.auditor_emp_id === empId);
  const disputed = scoped.filter(a => a.status === 'disputed');

  async function skip(a) {
    if (!await confirmDialog({ title: 'Skip this claim?', message: 'It is taken out of the audit queue.', tone: 'warning', confirmText: 'Skip' })) return;
    if (await setAuditActive(a, false, user)) reload();
  }

  const list = (title, rows, action) => rows.length > 0 && (
    <div className="card mb-16">
      <div className="card-header"><div className="card-title">{title} <span className="text-sm text-muted">· {rows.length}</span></div></div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{['Agent', 'Work date', 'Claim #', 'Scorecard', 'Status', ''].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id}>
                <td style={cell}>{names[a.agent_emp_id] ?? a.agent_emp_id}</td>
                <td style={cell}>{fmtDate(a.work_date)}</td>
                <td style={cell}>{a.claim_number ?? '—'}</td>
                <td style={cell}>{cardName(a.scorecard_id)}</td>
                <td style={cell}><span className={`badge ${qaStatusOf(a.status).badge}`}>{qaStatusOf(a.status).label}</span></td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{action(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {header}
      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id}
            onClick={() => { setTab(id); setEditing(null); }}>{label}</button>
        ))}
      </div>

      {tab === 'audit' && auditor && editing && (
        <QaAuditForm audit={editing} setup={setup} ctx={ctx} people={people} user={user} mistakes={mistakes ?? []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
      {tab === 'audit' && auditor && !editing && (
        <>
          <div className="card mb-16">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn-primary" onClick={() => setEditing({})} disabled={!setup.scorecards.some(c => c.active !== false)}>+ New audit</button>
              <span className="text-sm text-muted">
                {setup.scorecards.some(c => c.active !== false)
                  ? 'Audit any claim, or use 🎲 Sampling to pick worked claims from the Smart Worklist.'
                  : manager ? 'Add a scorecard first (🗂 Scorecards & categories).' : 'Ask a manager to add a QA scorecard first.'}
              </span>
            </div>
          </div>
          {list('⚖️ Disputes to resolve', disputed.filter(a => a.agent_emp_id !== empId), a => <button className="btn-sm" onClick={() => setResolving(a)}>Resolve</button>)}
          {list('📝 My drafts', drafts, a => <button className="btn-sm" onClick={() => setEditing(a)}>Continue</button>)}
          {list('🎲 To audit (sampled)', queued, a => (
            <span className="row" style={{ gap: 4 }}>
              <button className="btn-sm" onClick={() => setEditing(a)}>Start</button>
              <button className="btn-sm" onClick={() => skip(a)}>Skip</button>
            </span>
          ))}
          {!disputed.length && !drafts.length && !queued.length && (
            <div className="card text-muted" style={{ textAlign: 'center' }}>Nothing waiting. Start a new audit or pick a sample.</div>
          )}
        </>
      )}

      {tab === 'mine' && <MyQaAudits audits={mine} setup={setup} ctx={ctx} names={names} user={user} onChanged={reload} mistakes={mistakes ?? []} />}
      {tab === 'library' && (
        <ErrorLibrary user={user} mistakes={mistakes} seen={seen} categories={setup.categories} ctx={ctx} onChanged={reload} />
      )}
      {tab === 'sampling' && auditor && (
        <QaSampling user={user} setup={setup} people={people} onQueued={() => { reload(); setTab('audit'); }} />
      )}
      {tab === 'results' && auditor && <QaResults audits={scoped} people={people} setup={setup} ctx={ctx} names={names} mistakes={mistakes ?? []} />}
      {tab === 'setup' && manager && <QaScorecards setup={setup} ctx={ctx} user={user} onChanged={reload} />}

      {resolving && (
        <ResolveModal audit={resolving} setup={setup} ctx={ctx} names={names} user={user}
          onClose={() => setResolving(null)} onSaved={() => { setResolving(null); reload(); }} />
      )}
    </div>
  );
}
