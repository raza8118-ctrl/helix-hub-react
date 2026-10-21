import { useState, useEffect, useSyncExternalStore } from 'react';
import { loadKnowledge, resetConversation, subscribeConversation, getConversation, LOOKUP_LABELS } from '../../lib/assistant';
import { openSopLibrary } from '../../lib/sops';
import HelixChat from '../../components/shared/HelixChat';
import PayerCard from './PayerCard';
import AuthChecklist from './AuthChecklist';
import { peekRecord, clearRecord } from '../../lib/navigate';

const openTab = id => window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: id }));

/**
 * 🤖 Ask Helix (roadmap 9.1): questions answered from Helix Hub's own data (Payer Directory, published SOPs, Denial
 * Navigator, Payer Updates) with source links, then labelled general guidance and 📍 "Where to do it" buttons. PHI-free
 * mode: the question is de-identified in the browser first; patient words block sending. The conversation is kept in
 * memory only and is the same one the floating 🤖 Ask panel shows.
 */
export default function AskHelix({ user }) {
  const [knowledge, setKnowledge] = useState(null);
  const [initialText] = useState(() => peekRecord('wb_assistant')?.question ?? '');   // 10.1: “Ask Helix: …” from global search
  const [authInitial] = useState(() => peekRecord('wb_assistant')?.tab === 'auth' ? peekRecord('wb_assistant') : null);   // 📍 Auth checklist
  const [payerCard, setPayerCard] = useState(null);
  const [tab, setTab] = useState(() => (authInitial ? 'auth' : 'ask'));   // 9.2: 'ask' | 'auth'
  const { chat, busy } = useSyncExternalStore(subscribeConversation, getConversation);

  useEffect(() => {
    let alive = true;
    clearRecord('wb_assistant');
    loadKnowledge(user).then(k => { if (alive) setKnowledge(k); });
    return () => { alive = false; };
  }, [user]);

  // Auth checklist sources
  function openSource(s) {
    if (s.kind === 'payer') setPayerCard(knowledge?.payers.find(p => p.id === s.id) ?? null);
    else if (s.kind === 'sop') openSopLibrary(s.label);
    else if (s.kind === 'denial') openTab('wb_denials');
    else openTab('wb_updates');
  }

  // A payer source opens the full payer card here; the conversation stays in memory
  if (payerCard) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <button className="btn-sm" style={{ marginBottom: 12 }} onClick={() => setPayerCard(null)}>← Back to Ask Helix</button>
        <PayerCard key={payerCard.id} payer={payerCard} user={user} onClose={() => setPayerCard(null)} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">🤖 Ask Helix</div>
          <div className="page-subtitle">Answers from the Payer Directory, SOPs, Denial Navigator and Payer Updates — with links to the source and where to do it.</div>
        </div>
        {tab === 'ask' && chat.length > 0 && <button className="btn-sm" onClick={resetConversation} disabled={!!busy}>↺ New conversation</button>}
      </div>

      {knowledge && (
        <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {[['ask', '💬 Ask'], ['auth', '🔐 Auth checklist']].map(([id, label]) => (
            <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}
      {knowledge && tab === 'auth' && (
        <AuthChecklist knowledge={knowledge} user={user} lookupLabels={LOOKUP_LABELS} onOpenSource={openSource}
          initialPayerId={authInitial?.payerId ?? null} initialService={authInitial?.service || ''} />
      )}

      {tab === 'ask' && <HelixChat user={user} knowledge={knowledge} initialText={initialText} onOpenPayer={setPayerCard} />}
    </div>
  );
}
