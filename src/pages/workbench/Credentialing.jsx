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
import { Button } from '../../components/ui';
import AiTestingBanner from '../../components/shared/AiTestingBanner';

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

  // Intro (the page title is in the top bar)
  const header = (
    <div className="fg-bar">
      <span className="fg-date">Payer enrollments, CAQH, revalidations and expiring licenses — with what is due next.</span>
    </div>
  );
  if (payerCard) {
    return (
      <div className="fg-page nb-page">
        <div><Button size="sm" onClick={() => setPayerCard(null)}>← Back to Credentialing</Button></div>
        <PayerCard key={payerCard.id} payer={payerCard} user={user} onClose={() => setPayerCard(null)} />
      </div>
    );
  }

  return (
    <div className="fg-page wl-page">
      {header}
      {data === undefined && <div className="card text-muted">Loading…</div>}
      {data === null && (
        <div className="card text-muted">
          Credentialing isn’t set up yet. An admin needs to run the database update (<code>20261021v_credentialing.sql</code>) in Supabase.
        </div>
      )}
      {data && (
        <>
          <div className="fg-choices wl-tabs" role="group" aria-label="Credentialing views">
            {[
              ['due', `⏰ Due soon${due.length ? ` (${due.length}${urgent ? ` · ${urgent} urgent` : ''})` : ''}`],
              ['providers', '👤 Providers'],
              ['enrollments', '🏥 Enrollments'],
              ['checklist', '✨ Enrollment checklist'],
            ].map(([id, label]) => (
              <Button key={id} size="sm" active={tab === id} aria-pressed={tab === id}
                onClick={() => { setTab(id); if (id !== 'providers') setOpenId(null); }}>{label}</Button>
            ))}
          </div>
          {tab === 'due' && <CredDueSoon items={due} ctx={ctx} user={user} canEdit={canEdit} onChanged={reload} onOpenProvider={openProvider} />}
          {tab === 'providers' && <CredProviders data={data} ctx={ctx} user={user} canEdit={canEdit} openId={openId} onOpen={setOpenId} onChanged={reload} />}
          {tab === 'enrollments' && <CredEnrollments data={data} ctx={ctx} user={user} canEdit={canEdit} onOpen={id => { setTab('providers'); setOpenId(id); }} onChanged={reload} />}
          {tab === 'checklist' && <AiTestingBanner />}
          {tab === 'checklist' && (knowledge
            ? <CredChecklist knowledge={knowledge} user={user} onOpenSource={openSource} />
            : <div className="card text-muted">Loading Helix Hub data…</div>)}
        </>
      )}
    </div>
  );
}
