import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadPeople } from '../../lib/qa';
import { loadBulletins, loadReads, canEditUpdates, bulletinLink, forTeam, isNew } from '../../lib/payerUpdates';
import { alertDialog } from '../../components/shared/Dialog';
import BulletinUpload from './BulletinUpload';
import BulletinList from './BulletinList';
import UpdatesForTeam from './UpdatesForTeam';
import UpdatesSearch from './UpdatesSearch';

/**
 * 📰 Payer Updates (roadmap 8.1 + 8.2): payer bulletins turned into a feed of changes — payer, effective date, what
 * changed, teams affected, action needed. 🆕 For my team (✓ Got it, sidebar count), 🔎 All updates (search + Excel),
 * 📋 By bulletin; uploading (with AI extraction) = “Manage payer updates”.
 */
export default function PayerUpdates({ user }) {
  const canEdit = canEditUpdates(user);
  const isLead = ['admin', 'manager', 'supervisor'].includes(user.role);
  const [bulletins, setBulletins] = useState(undefined);   // undefined = loading, null = not set up
  const [reads, setReads] = useState({});                   // null = read tracking not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [people, setPeople] = useState([]);
  const [tab, setTab] = useState('team');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    loadStepContext().then(c => { if (alive) setCtx(c); });
    if (isLead) loadPeople().then(p => { if (alive) setPeople(p); });
    return () => { alive = false; };
  }, [isLead]);
  useEffect(() => {
    let alive = true;
    Promise.all([loadBulletins({ includeRetired: true }), loadReads()]).then(([b, r]) => {
      if (!alive) return;
      setBulletins(b); setReads(r);
    });
    return () => { alive = false; };
  }, [reloadKey]);

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
            ].map(([id, label]) => (
              <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'team' && (
            <UpdatesForTeam updates={updates} reads={reads} people={people} ctx={ctx} user={user} showReaders={isLead} onChanged={reload} onOpenPdf={openPdf} />
          )}
          {tab === 'all' && <UpdatesSearch updates={updates} reads={reads} ctx={ctx} user={user} canEdit={canEdit} onChanged={reload} onOpenPdf={openPdf} />}
          {tab === 'list' && <BulletinList bulletins={activeBulletins} ctx={ctx} user={user} canEdit={canEdit} onChanged={reload} />}
          {tab === 'upload' && canEdit && (
            <BulletinUpload ctx={ctx} user={user}
              onSaved={b => {
                reload(); setTab('list');
                alertDialog({ title: 'Bulletin saved', message: `“${b.title}” is now in the feed.`, tone: 'success' });
              }} />
          )}
        </>
      )}
    </div>
  );
}
