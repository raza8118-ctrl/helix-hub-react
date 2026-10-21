import { useState, useMemo } from 'react';
import {
  SEVERITIES, TEXT_FIELDS, severityOf, stepsOf, needsRecheck, filterMistakes, canEditMistakes, SEEN_DAYS,
  publishMistake, verifyMistake, setMistakeActive, addStarterMistakes, missingStarterMistakes,
} from '../../lib/mistakes';
import { openSopLibrary } from '../../lib/sops';
import { TEAMS } from '../../lib/constants';
import CopyButton from '../../components/shared/CopyButton';
import { alertDialog } from '../../components/shared/Dialog';
import MistakeEditor from './MistakeEditor';

const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const openDenials = () => window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_denials' }));

/** The full entry: what goes wrong, why it matters, fix steps, how to avoid it, links (also shown from My audits). */
export function MistakeDetails({ m, ctx }) {
  const sop = m.sop_id ? ctx.sops.find(s => s.id === m.sop_id) : null;
  const client = m.client_id ? ctx.clients.find(c => c.id === m.client_id) : null;
  const payer = m.payer_id ? ctx.payers.find(p => p.id === m.payer_id) : null;
  return (
    <div>
      {TEXT_FIELDS.map(f => m[f.key] && (
        <div key={f.key} style={{ marginBottom: 8 }}>
          <div className="bold text-sm">{f.label}</div>
          {f.steps
            ? <ol style={{ margin: '2px 0 0', paddingLeft: 20 }}>{stepsOf(m[f.key]).map((s, i) => <li key={i}>{s}</li>)}</ol>
            : <div style={{ whiteSpace: 'pre-wrap' }}>{m[f.key]}</div>}
        </div>
      ))}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {sop && <button type="button" className="btn-sm" onClick={() => openSopLibrary(sop.title)}>📚 {sop.title}</button>}
        {m.denial_code && (
          <span className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span className="badge badge-blue">{m.denial_code}</span>
            <CopyButton value={m.denial_code} />
            <button type="button" className="btn-sm" onClick={openDenials}>Open in Denial Navigator ›</button>
          </span>
        )}
        {client && <span className="badge badge-gray">Client: {client.name}</span>}
        {payer && <span className="badge badge-gray">Payer: {payer.name}</span>}
      </div>
    </div>
  );
}

/**
 * 📖 Mistakes & fixes (roadmap 7.2): the error library. Everyone searches and suggests; editors (“Edit error library”
 * or the QA flag) add, publish, mark checked and turn entries off. mistakes = null until the 7.2 update is run.
 */
export default function ErrorLibrary({ user, mistakes, seen, categories, ctx, onChanged }) {
  const editor = canEditMistakes(user);
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState(user.team && TEAMS.includes(user.team) ? user.team : 'ALL');
  const [categoryId, setCategoryId] = useState('ALL');
  const [clientId, setClientId] = useState('ALL');
  const [payerId, setPayerId] = useState('ALL');
  const [severity, setSeverity] = useState('ALL');
  const [status, setStatus] = useState('published');
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);                 // { row } — row null = new
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => filterMistakes(mistakes ?? [], {
    query, team, categoryId, clientId, payerId, severity, status: editor ? status : 'published', showInactive: editor && showInactive,
  }), [mistakes, query, team, categoryId, clientId, payerId, severity, status, editor, showInactive]);
  // Payer filter offers only payers that have an entry
  const payersUsed = useMemo(() => ctx.payers.filter(p => (mistakes ?? []).some(m => m.payer_id === p.id)), [ctx.payers, mistakes]);

  if (mistakes === null) {
    return (
      <div className="card text-muted">
        The error library isn’t set up yet. An admin needs to run the error library database update
        (<code>20261021n_error_library.sql</code>) in Supabase.
      </div>
    );
  }

  const suggestions = mistakes.filter(m => m.status === 'suggested' && m.active !== false).length;
  const missing = editor ? missingStarterMistakes(mistakes) : 0;
  const catName = id => categories.find(c => c.id === id)?.name;
  async function run(fn) { setBusy(true); await fn(); setBusy(false); onChanged(); }
  async function starters() {
    setBusy(true);
    const n = await addStarterMistakes(mistakes, categories, user);
    setBusy(false);
    onChanged();
    alertDialog({ title: 'Starter entries added', message: `${n} entries added. They are in our own words — please check and adjust them for your clients.`, tone: 'success' });
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 240px', marginBottom: 0 }}><label>Search</label>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. corrected claim, posting, auth, CO-29…" />
          </div>
          <div className="field" style={{ flex: '1 1 130px', marginBottom: 0 }}><label>Team</label>
            <select value={team} onChange={e => setTeam(e.target.value)}>
              <option value="ALL">All teams</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}><label>Category</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
              <option value="ALL">All</option>
              {categories.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}><label>Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
              <option value="ALL">All</option>
              {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {payersUsed.length > 0 && (
            <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}><label>Payer</label>
              <select value={payerId} onChange={e => setPayerId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
                <option value="ALL">All</option>
                {payersUsed.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="field" style={{ flex: '1 1 110px', marginBottom: 0 }}><label>Severity</label>
            <select value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="ALL">All</option>
              {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <button className={editor ? 'btn-primary' : 'btn-sm'} onClick={() => setEdit({ row: null })}>{editor ? '+ Add mistake' : '💡 Suggest a mistake'}</button>
          {editor && missing > 0 && <button className="btn-sm" disabled={busy} onClick={starters}>Add starter entries ({missing})</button>}
          {editor && (
            <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Which entries">
              <option value="published">Published</option>
              <option value="suggested">Suggestions ({suggestions})</option>
              <option value="ALL">All</option>
            </select>
          )}
          {editor && (
            <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show turned-off
            </label>
          )}
          <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>{list.length} {list.length === 1 ? 'entry' : 'entries'}</span>
        </div>
      </div>

      {list.length === 0 && (
        <div className="card text-muted" style={{ textAlign: 'center' }}>
          {mistakes.length === 0 ? (editor ? 'No entries yet — add one or use “Add starter entries”.' : 'No entries yet — suggest the first one.') : 'Nothing matches.'}
        </div>
      )}

      {list.map(m => {
        const sev = severityOf(m.severity);
        const expanded = open === m.id;
        return (
          <div key={m.id} className="card mb-16" style={m.active === false ? { opacity: 0.55 } : undefined}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setOpen(expanded ? null : m.id)} role="button" aria-expanded={expanded}>
              <span>{expanded ? '▾' : '▸'}</span>
              <span className="bold" style={{ flex: '1 1 240px' }}>{m.title}</span>
              <span className={`badge ${sev.badge}`}>{sev.label}</span>
              {m.team && <span className="badge badge-gray">{m.team}</span>}
              {catName(m.category_id) && <span className="text-sm text-muted">{catName(m.category_id)}</span>}
              {seen[m.id] > 0 && <span className="badge badge-purple" title={`Failed QA checkpoints in the last ${SEEN_DAYS} days`}>Seen in QA: {seen[m.id]}</span>}
              {m.status === 'suggested' && <span className="badge badge-blue">Suggestion</span>}
              {editor && m.status === 'published' && needsRecheck(m) && <span className="badge badge-yellow">Re-check</span>}
              {m.active === false && <span className="badge badge-gray">Turned off</span>}
            </div>
            {expanded && (
              <div style={{ marginTop: 10 }}>
                <MistakeDetails m={m} ctx={ctx} />
                {m.verified_at && <div className="text-sm text-muted" style={{ marginTop: 6 }}>✓ Checked {fmtDate(m.verified_at)}</div>}
                {editor && (
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <button className="btn-sm" disabled={busy} onClick={() => setEdit({ row: m })}>✏️ Edit</button>
                    {m.status === 'suggested'
                      ? <button className="btn-primary btn-sm" disabled={busy} onClick={() => run(() => publishMistake(m, user))}>Publish</button>
                      : <button className="btn-sm" disabled={busy} onClick={() => run(() => verifyMistake(m, user))}>✓ Mark checked today</button>}
                    <button className="btn-sm" disabled={busy} onClick={() => run(() => setMistakeActive(m, m.active === false, user))}>{m.active === false ? 'Turn on' : 'Turn off'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {edit && (
        <MistakeEditor row={edit.row} categories={categories} ctx={ctx} user={user}
          onClose={() => setEdit(null)}
          onSaved={() => {
            const suggested = !edit.row && !editor;
            setEdit(null); onChanged();
            if (suggested) alertDialog({ title: 'Thank you', message: 'Your suggestion was sent to QA for review.', tone: 'success' });
          }} />
      )}
    </>
  );
}
