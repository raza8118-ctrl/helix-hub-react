import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadCred, dueItems, canEditCred } from '../../lib/credentialing';
import { loadKnowledge } from '../../lib/assistant';
import { openSopLibrary } from '../../lib/sops';
import CredDueSoon from './CredDueSoon';
import CredProviders from './CredProviders';
import CredEnrollments from './CredEnrollments';
import CredChecklist from './CredChecklist';
import PayerCard from './PayerCard';
import { peekRecord, clearRecord } from '../../lib/navigate';

const openTab = id => window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: id }));

/**
 * 🪪 Credentialing (roadmap 9.3): ⏰ Due soon (CAQH, revalidations, expiring items, stuck enrollments), 👤 Providers
 * (enrollments, licenses, status checklist), 🏥 Enrollments grid and ✨ AI enrollment checklist. No patient data;
 * practitioner SSN / DOB / home address are never stored. Everyone views; “Manage credentialing” edits.
 */
export default function Credentialing({ user }) {
  const canEdit = canEditCred(user);
  const [data, setData] = useState(undefined);           // undefined = loading, null = not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [knowledge, setKnowledge] = useState(null);      // AI lookups — loaded when the checklist tab opens
  const [tab, setTab] = useState(() => (peekRecord('wb_credentialing')?.providerId ? 'providers' : 'due'));   // 10.1
  const [openId, setOpenId] = useState(() => peekRecord('wb_credentialing')?.providerId ?? null);
  const [payerCard, setPayerCard] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    clearRecord('wb_credentialing');
    loadStepContext().then(c => { if (alive) setCtx(c); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    loadCred().then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [reloadKey]);
  const needKnowledge = tab === 'checklist' && !knowledge;
  useEffect(() => {
    let alive = true;
    if (needKnowledge) loadKnowledge(user).then(k => { if (alive) setKnowledge(k); });
    return () => { alive = false; };
  }, [needKnowledge, user]);

  const due = useMemo(() => (data ? dueItems(data, ctx.payers) : []), [data, ctx.payers]);
  const urgent = due.filter(i => i.days <= 30).length;

  function openProvider(p) { setTab('providers'); setOpenId(p.id); }
  function openSource(s) {
    if (s.kind === 'payer') setPayerCard(ctx.payers.find(p => p.id === s.id) ?? null);
    else if (s.kind === 'sop') openSopLibrary(s.label);
    else openTab('wb_updates');
  }

  const header = (
    <div className="page-header">
      <div>
        <div className="page-title">🪪 Credentialing</div>
        <div className="page-subtitle">Payer enrollments, CAQH, revalidations and expiring licenses — with what is due next.</div>
      </div>
    </div>
  );
  if (payerCard) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <button className="btn-sm" style={{ marginBottom: 12 }} onClick={() => setPayerCard(null)}>← Back to Credentialing</button>
        <PayerCard key={payerCard.id} payer={payerCard} user={user} onClose={() => setPayerCard(null)} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {header}
      {data === undefined && <div className="card text-muted">Loading…</div>}
      {data === null && (
        <div className="card text-muted">
          Credentialing isn’t set up yet. An admin needs to run the database update (<code>20261021v_credentialing.sql</code>) in Supabase.
        </div>
      )}
      {data && (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              ['due', `⏰ Due soon${due.length ? ` (${due.length}${urgent ? ` · ${urgent} urgent` : ''})` : ''}`],
              ['providers', '👤 Providers'],
              ['enrollments', '🏥 Enrollments'],
              ['checklist', '✨ Enrollment checklist'],
            ].map(([id, label]) => (
              <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id}
                onClick={() => { setTab(id); if (id !== 'providers') setOpenId(null); }}>{label}</button>
            ))}
          </div>
          {tab === 'due' && <CredDueSoon items={due} ctx={ctx} user={user} canEdit={canEdit} onChanged={reload} onOpenProvider={openProvider} />}
          {tab === 'providers' && <CredProviders data={data} ctx={ctx} user={user} canEdit={canEdit} openId={openId} onOpen={setOpenId} onChanged={reload} />}
          {tab === 'enrollments' && <CredEnrollments data={data} ctx={ctx} user={user} canEdit={canEdit} onOpen={id => { setTab('providers'); setOpenId(id); }} onChanged={reload} />}
          {tab === 'checklist' && (knowledge
            ? <CredChecklist knowledge={knowledge} user={user} onOpenSource={openSource} />
            : <div className="card text-muted">Loading Helix Hub data…</div>)}
        </>
      )}
    </div>
  );
}
