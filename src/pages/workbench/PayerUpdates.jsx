import { useState, useEffect } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadBulletins, canEditUpdates } from '../../lib/payerUpdates';
import { alertDialog } from '../../components/shared/Dialog';
import BulletinUpload from './BulletinUpload';
import BulletinList from './BulletinList';

/**
 * 📰 Payer Updates (roadmap 8.1): payer bulletins turned into a feed of changes — payer, effective date, what changed,
 * teams affected, action needed. Uploading (with AI extraction) = “Manage payer updates”; reading is for everyone.
 */
export default function PayerUpdates({ user }) {
  const canEdit = canEditUpdates(user);
  const [bulletins, setBulletins] = useState(undefined);   // undefined = loading, null = not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [tab, setTab] = useState('list');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    loadStepContext().then(c => { if (alive) setCtx(c); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    loadBulletins().then(b => { if (alive) setBulletins(b); });
    return () => { alive = false; };
  }, [reloadKey]);

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
            {[['list', '📋 Recent updates'], ...(canEdit ? [['upload', '⬆ Upload bulletin']] : [])].map(([id, label]) => (
              <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'list' && <BulletinList bulletins={bulletins} ctx={ctx} user={user} canEdit={canEdit} onChanged={reload} />}
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
