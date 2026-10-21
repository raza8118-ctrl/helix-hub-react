import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadPeople } from '../../lib/qa';
import { loadBulletins, loadReads, canEditUpdates, bulletinLink, forTeam, isNew } from '../../lib/payerUpdates';
import { alertDialog } from '../../components/shared/Dialog';
import BulletinUpload from './BulletinUpload';
import BulletinList from './BulletinList';
import UpdatesForTeam from './UpdatesForTeam';
import UpdatesSearch from './UpdatesSearch';
import DirectorySuggestions from './DirectorySuggestions';
import { peekRecord, clearRecord } from '../../lib/navigate';
import { loadSuggestions, suggestFromBulletin, canApproveSuggestions, peekOpenSuggestions, clearOpenSuggestions } from '../../lib/payerSuggestions';

/**
 * 📰 Payer Updates (roadmap 8.1 + 8.2): payer bulletins turned into a feed of changes — payer, effective date, what
 * changed, teams affected, action needed. 🆕 For my team (✓ Got it, sidebar count), 🔎 All updates (search + Excel),
 * 📋 By bulletin; uploading (with AI extraction) = “Manage payer updates”.
 */
export default function PayerUpdates({ user }) {
  const canEdit = canEditUpdates(user);
  const isLead = ['admin', 'manager', 'supervisor'].includes(user.role);
  const seesSuggestions = canEdit || canApproveSuggestions(user);   // 8.3
  const [bulletins, setBulletins] = useState(undefined);   // undefined = loading, null = not set up
  const [reads, setReads] = useState({});                   // null = read tracking not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [people, setPeople] = useState([]);
  const [suggestions, setSuggestions] = useState(null);     // 8.3; null = not set up / not shown
  const [suggesting, setSuggesting] = useState(null);       // bulletin id being read
  const [tab, setTab] = useState(() => peekRecord('wb_updates')?.tab ?? (peekOpenSuggestions() ? 'suggestions' : 'team'));   // 8.3 / 10.1
  const [initialQuery] = useState(() => peekRecord('wb_updates')?.query ?? '');   // 10.1: from global search
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    clearOpenSuggestions();
    clearRecord('wb_updates');
    loadStepContext().then(c => { if (alive) setCtx(c); });
    if (isLead) loadPeople().then(p => { if (alive) setPeople(p); });
    return () => { alive = false; };
  }, [isLead]);
  useEffect(() => {
    let alive = true;
    Promise.all([loadBulletins({ includeRetired: true }), loadReads(), seesSuggestions ? loadSuggestions() : null]).then(([b, r, s]) => {
      if (!alive) return;
      setBulletins(b); setReads(r); setSuggestions(s);
    });
    return () => { alive = false; };
  }, [reloadKey, seesSuggestions]);

  // Every change with its bulletin attached (search + team views)
  const updates = useMemo(() => (bulletins ?? []).flatMap(b => b.updates.map(u => ({ ...u, bulletin: b }))), [bulletins]);
  // The 8.1 bulletin list shows active changes only
  const activeBulletins = useMemo(() => (bulletins ?? []).map(b => ({ ...b, updates: b.updates.filter(u => u.status === 'active') })), [bulletins]);
  const newForMe = reads ? updates.filter(u => u.status === 'active' && u.bulletin.active !== false && isNew(u) && forTeam(u, user.team)
    && !(reads[u.id] ?? []).includes(user.emp_id)).length : 0;

  async function openPdf(b) {
    const w = window.open('', '_blank');   // opened before the await so the browser doesn't block it
    const url = await bulletinLink(b.file_path);
    if (url && w) w.location.href = url; else w?.close();
  }

  // 8.3: 💡 Suggest directory changes (also right after an AI-read bulletin is saved, with its PDF still in memory)
  async function runSuggest(b, file = null) {
    if (suggestions === null) {
      if (!file) alertDialog({ title: 'Not set up yet', message: 'Directory suggestions need the database update 20261021t_payer_suggestions.sql.', tone: 'warning' });
      return;
    }
    setSuggesting(b.id);
    try {
      const r = await suggestFromBulletin(b, ctx.payers, user, file);
      reload();
      alertDialog({
        title: r.added ? `${r.added} directory ${r.added === 1 ? 'change' : 'changes'} suggested` : 'No directory changes found',
        message: r.added ? 'They wait in 🛠 Directory suggestions until someone who can edit the Payer Directory approves them.'
          : `Nothing in this bulletin changes the Payer Directory${r.same ? ` (${r.same} already match)` : ''}.`,
        tone: 'success',
      });
    } catch (e) {
      alertDialog({ title: 'Could not suggest directory changes', message: e.message === 'NO_KEY' ? 'No AI key is saved in Settings.' : e.message, tone: 'warning' });
    }
    setSuggesting(null);
  }
  const pendingSuggestions = (suggestions ?? []).filter(s => s.status === 'pending').length;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">📰 Payer Updates</div>
          <div className="page-subtitle">What payers changed, when it starts, who it affects and what to do — from payer bulletins.</div>
        </div>
      </div>

      {bulletins === undefined && <div className="card text-muted">Loading…</div>}
      {bulletins === null && (
        <div className="card text-muted">
          Payer Updates aren’t set up yet. An admin needs to run the database update (<code>20261021r_payer_updates.sql</code>) in Supabase.
        </div>
      )}

      {bulletins && (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              ['team', `🆕 For my team${newForMe ? ` (${newForMe} new)` : ''}`],
              ['all', '🔎 All updates'],
              ['list', '📋 By bulletin'],
              ...(canEdit ? [['upload', '⬆ Upload bulletin']] : []),
              ...(seesSuggestions && suggestions ? [['suggestions', `🛠 Directory suggestions${pendingSuggestions ? ` (${pendingSuggestions})` : ''}`]] : []),
            ].map(([id, label]) => (
              <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'team' && (
            <UpdatesForTeam updates={updates} reads={reads} people={people} ctx={ctx} user={user} showReaders={isLead} onChanged={reload} onOpenPdf={openPdf} />
          )}
          {tab === 'all' && <UpdatesSearch initialQuery={initialQuery} updates={updates} reads={reads} ctx={ctx} user={user} canEdit={canEdit} onChanged={reload} onOpenPdf={openPdf} />}
          {tab === 'list' && (
            <BulletinList bulletins={activeBulletins} ctx={ctx} user={user} canEdit={canEdit} onChanged={reload}
              onSuggest={suggestions ? b => runSuggest(b) : null} suggesting={suggesting} />
          )}
          {tab === 'upload' && canEdit && (
            <BulletinUpload ctx={ctx} user={user}
              onSaved={async (b, pdf) => {
                reload(); setTab('list');
                await alertDialog({ title: 'Bulletin saved', message: `“${b.title}” is now in the feed.${pdf && suggestions ? ' Looking for Payer Directory changes next…' : ''}`, tone: 'success' });
                if (pdf) runSuggest(b, pdf);
              }} />
          )}
          {tab === 'suggestions' && seesSuggestions && suggestions && (
            <DirectorySuggestions suggestions={suggestions} bulletins={bulletins} ctx={ctx} user={user} onChanged={reload} onOpenPdf={openPdf} />
          )}
        </>
      )}
    </div>
  );
}
