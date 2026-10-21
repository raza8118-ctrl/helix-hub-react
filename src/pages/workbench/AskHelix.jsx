import { useState, useEffect, useRef } from 'react';
import { deidentify, loadKnowledge, ask, MAX_QUESTIONS } from '../../lib/assistant';
import { openSopLibrary } from '../../lib/sops';
import CopyButton from '../../components/shared/CopyButton';
import PayerCard from './PayerCard';
import AuthChecklist from './AuthChecklist';
import { peekRecord, clearRecord } from '../../lib/navigate';

const EXAMPLES = [
  'What is the appeal fax and appeal filing limit for Aetna?',
  'What should I do for a CO-197 denial from UnitedHealthcare?',
  'How do I check claim status in Availity?',
  'Any recent changes from Humana that affect authorizations?',
];
const LOOKUP_LABELS = {
  search_payers: 'Payer Directory', get_payer: 'payer card', search_sops: 'SOP Library', get_sop: 'SOP',
  search_denial_codes: 'Denial Navigator', get_denial_steps: 'denial steps', search_payer_updates: 'Payer Updates', list_clients: 'client list', get_auth_rules: 'auth rules',
};
const SOURCE_ICONS = { payer: '📇', sop: '📚', denial: '🧩', updates: '📰' };
const openTab = id => window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: id }));

/** **bold** → <b>; everything else as typed (line breaks kept by pre-wrap). */
const withBold = text => String(text).split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

/**
 * 🤖 Ask Helix (roadmap 9.1): questions answered from Helix Hub's own data (Payer Directory, published SOPs, Denial
 * Navigator, Payer Updates) with source links. PHI-free mode: the question is de-identified in the browser first;
 * patient words block sending. The conversation is kept in memory only.
 */
export default function AskHelix({ user }) {
  const [knowledge, setKnowledge] = useState(null);
  const [text, setText] = useState(() => peekRecord('wb_assistant')?.question ?? '');   // 10.1: “Ask Helix: …” from global search
  const [preview, setPreview] = useState(null);          // de-identified text waiting for “Send”
  const [blocked, setBlocked] = useState(null);          // patient words found
  const [chat, setChat] = useState([]);                  // [{ role, text, sources?, error? }]
  const [history, setHistory] = useState([]);            // API messages (append-only)
  const [busy, setBusy] = useState('');
  const [payerCard, setPayerCard] = useState(null);
  const [tab, setTab] = useState('ask');                 // 9.2: 'ask' | 'auth'
  const endRef = useRef(null);

  useEffect(() => {
    let alive = true;
    clearRecord('wb_assistant');
    loadKnowledge(user).then(k => { if (alive) setKnowledge(k); });
    return () => { alive = false; };
  }, [user]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat, busy]);

  const asked = chat.filter(m => m.role === 'user').length;
  const full = asked >= MAX_QUESTIONS;

  function submit(raw = text) {
    if (!raw.trim() || busy || full) return;
    setBlocked(null);
    const d = deidentify(raw);
    if (d.blocked) return setBlocked(d.blocked);
    if (d.replaced) return setPreview(d.text);
    send(d.text);
  }

  async function send(question) {
    setPreview(null);
    setText('');
    setChat(c => [...c, { role: 'user', text: question }]);
    setBusy('Thinking…');
    try {
      const r = await ask(question, history, knowledge, user, name => setBusy(`Looking in the ${LOOKUP_LABELS[name] ?? 'records'}…`));
      setHistory(r.messages);
      setChat(c => [...c, { role: 'assistant', text: r.answer, sources: r.sources }]);
    } catch (e) {
      setChat(c => [...c, { role: 'assistant', error: true,
        text: e.message === 'NO_KEY' ? 'No AI key is saved in Settings — an admin can add one. Meanwhile use the Payer Directory, SOP Library or Denial Navigator search.' : e.message }]);
    }
    setBusy('');
  }

  function reset() { setChat([]); setHistory([]); setPreview(null); setBlocked(null); setText(''); }

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
          <div className="page-subtitle">Answers from the Payer Directory, SOPs, Denial Navigator and Payer Updates — with links to the source.</div>
        </div>
        {tab === 'ask' && chat.length > 0 && <button className="btn-sm" onClick={reset} disabled={!!busy}>↺ New conversation</button>}
      </div>

      {!knowledge && <div className="card text-muted">Loading Helix Hub data…</div>}

      {knowledge && (
        <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {[['ask', '💬 Ask'], ['auth', '🔐 Auth checklist']].map(([id, label]) => (
            <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}
      {knowledge && tab === 'auth' && <AuthChecklist knowledge={knowledge} user={user} lookupLabels={LOOKUP_LABELS} onOpenSource={openSource} />}

      {tab === 'ask' && (<>

      {knowledge && chat.length === 0 && (
        <div className="card mb-16">
          <div className="text-sm text-muted" style={{ marginBottom: 8 }}>Try asking:</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {EXAMPLES.map(q => <button key={q} className="btn-sm" onClick={() => setText(q)}>{q}</button>)}
          </div>
        </div>
      )}

      {chat.map((m, i) => (
        <div key={i} className="card mb-16" style={m.role === 'user' ? { marginLeft: '15%', background: 'var(--surface-2, var(--surface))' } : { marginRight: '5%' }}>
          <div className="text-sm text-muted" style={{ marginBottom: 4 }}>{m.role === 'user' ? '🙋 You (as sent)' : '🤖 Helix'}</div>
          <div style={{ whiteSpace: 'pre-wrap', ...(m.error ? { color: 'var(--danger)' } : {}) }}>{withBold(m.text)}</div>
          {m.role === 'assistant' && !m.error && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {(m.sources ?? []).map(s => (
                <button key={`${s.kind}:${s.id}`} className="btn-sm" onClick={() => openSource(s)} title="Open the source">
                  {SOURCE_ICONS[s.kind]} {s.label}
                </button>
              ))}
              <span style={{ marginLeft: 'auto' }}><CopyButton value={m.text.replace(/\*\*/g, '')} label="📋 Copy answer" /></span>
            </div>
          )}
        </div>
      ))}
      {busy && <div className="card mb-16 text-sm text-muted">⏳ {busy}</div>}
      <div ref={endRef} />

      {preview != null && (
        <div className="card mb-16" style={{ borderLeft: '4px solid var(--warning, #f59e0b)' }}>
          <div className="bold" style={{ marginBottom: 4 }}>🔒 This is what will be sent</div>
          <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{preview}</div>
          <div className="text-sm text-muted" style={{ marginBottom: 8 }}>Dates, numbers, IDs, phone numbers and emails were replaced so they never leave this computer.</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn-primary btn-sm" onClick={() => send(preview)}>Send</button>
            <button className="btn-sm" onClick={() => setPreview(null)}>Edit my question</button>
          </div>
        </div>
      )}
      {blocked && (
        <div className="card mb-16" style={{ borderLeft: '4px solid var(--danger)' }}>
          <div className="bold" style={{ color: 'var(--danger)' }}>Not sent — this looks like patient information</div>
          <div className="text-sm">Found: {blocked.join(', ')}. Ask about the payer, code or process instead — for example “What does N290 mean for Aetna?”.</div>
        </div>
      )}

      {knowledge && (
        <div className="card mb-16">
          {full ? (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="text-sm text-muted">This conversation has reached {MAX_QUESTIONS} questions.</span>
              <button className="btn-primary btn-sm" onClick={reset}>↺ Start a new conversation</button>
            </div>
          ) : (
            <>
              <textarea rows={2} value={text} maxLength={1000} disabled={!!busy || preview != null} placeholder="Ask about a payer, a denial code, an SOP or a payer change…"
                onChange={e => { setText(e.target.value); setBlocked(null); }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} style={{ width: '100%' }} />
              <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <span className="text-sm text-muted" style={{ flex: '1 1 260px' }}>
                  🔒 Never type patient names — Helix can’t tell a name from a word. Nothing here is saved.
                </span>
                <button className="btn-primary" onClick={() => submit()} disabled={!!busy || !text.trim() || preview != null}>Ask</button>
              </div>
            </>
          )}
        </div>
      )}
      </>)}
    </div>
  );
}
