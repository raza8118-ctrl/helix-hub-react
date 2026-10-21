import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  deidentify, sendQuestion, resetConversation, subscribeConversation, getConversation, helixCanOpen, MAX_QUESTIONS, GENERAL_LABEL,
} from '../../lib/assistant';
import { startAppeal } from '../../lib/appeals';
import { startClaimNote } from '../../lib/claimNotes';
import { setRecord } from '../../lib/navigate';
import CopyButton from './CopyButton';

const EXAMPLES = [
  'What is the appeal fax and appeal filing limit for Aetna?',
  'What should I do for a CO-197 denial from UnitedHealthcare?',
  'How do I check claim status in Availity?',
  'Any recent changes from Humana that affect authorizations?',
];
const SOURCE_ICONS = { payer: '📇', sop: '📚', denial: '🧩', updates: '📰' };

/** Opens a sidebar page and remounts it so it reads the handed-over record (App listens). */
const openPage = tab => window.dispatchEvent(new CustomEvent('helix:open-page', { detail: tab }));

/** **bold** → <b>; everything else as typed (line breaks kept by pre-wrap). */
const withBold = text => String(text).split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

/** The Helix Hub part, then the "General guidance" part in its own box. */
function Answer({ text, error }) {
  const at = error ? -1 : text.indexOf(GENERAL_LABEL);
  if (at < 0) return <div style={{ whiteSpace: 'pre-wrap', ...(error ? { color: 'var(--danger)' } : {}) }}>{withBold(text)}</div>;
  const main = text.slice(0, at).replace(/\*\*\s*$/, '').trim();
  const general = text.slice(at + GENERAL_LABEL.length).replace(/^\s*\*\*/, '').trim();
  return (
    <>
      {main && <div style={{ whiteSpace: 'pre-wrap' }}>{withBold(main)}</div>}
      <div style={{ marginTop: main ? 10 : 0, padding: '8px 10px', borderLeft: '3px solid var(--warning, #f59e0b)', background: 'var(--surface-2, var(--surface))', borderRadius: 'var(--radius-sm, 6px)' }}>
        <div className="text-sm bold" style={{ marginBottom: 4 }}>💡 General guidance — check the payer / SOP</div>
        <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{withBold(general)}</div>
      </div>
    </>
  );
}

/**
 * 🤖 The Ask Helix conversation, shared by the Ask Helix page and the floating chat panel (memory only — the same
 * conversation shows in both). PHI-free: the question is de-identified in the browser first; patient words block sending.
 * Answers show 📍 "Where to do it" buttons that open a page pre-filled with payer / client / code / service only.
 * compact = panel layout (the list scrolls inside); onOpenPayer(payer) shows a payer card in place (page only);
 * onLeave() runs after a button opens another page (the panel closes).
 */
export default function HelixChat({ user, knowledge, initialText = '', compact = false, onOpenPayer, onLeave }) {
  const { chat, busy } = useSyncExternalStore(subscribeConversation, getConversation);
  const [text, setText] = useState(initialText);
  const [preview, setPreview] = useState(null);          // de-identified text waiting for “Send”
  const [blocked, setBlocked] = useState(null);          // patient words found
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat, busy]);
  useEffect(() => { if (compact) inputRef.current?.focus(); }, [compact]);

  const asked = chat.filter(m => m.role === 'user').length;
  const full = asked >= MAX_QUESTIONS;

  function submit(raw = text) {
    if (!raw.trim() || busy || full || !knowledge) return;
    setBlocked(null);
    const d = deidentify(raw);
    if (d.blocked) return setBlocked(d.blocked);
    if (d.replaced) return setPreview(d.text);
    send(d.text);
  }

  function send(question) {
    setPreview(null);
    setText('');
    sendQuestion(question, knowledge, user);
  }

  function reset() { resetConversation(); setPreview(null); setBlocked(null); setText(''); }

  function go(tab, record) {
    if (record) setRecord(tab, record);
    openPage(tab);
    onLeave?.();
  }

  function openSource(s) {
    if (s.kind === 'payer') {
      const p = knowledge?.payers.find(x => x.id === s.id);
      if (onOpenPayer && p) return onOpenPayer(p);
      return go('wb_payers', { payerId: s.id });
    }
    if (s.kind === 'sop') return go('wb_sops', { query: s.label });
    if (s.kind === 'denial') return go('wb_denials', { query: s.label });
    return go('wb_updates', null);
  }

  function doIt(a) {
    if (a.appeal) startAppeal(a.appeal);
    if (a.note) startClaimNote(a.note);
    go(a.tab, a.record);
  }

  const bubble = m => (m.role === 'user'
    ? { marginLeft: compact ? '10%' : '15%', background: 'var(--surface-2, var(--surface))' }
    : { marginRight: compact ? 0 : '5%' });

  const list = (
    <>
      {knowledge && chat.length === 0 && (
        <div className="card mb-16">
          <div className="text-sm text-muted" style={{ marginBottom: 8 }}>Try asking:</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {EXAMPLES.map(q => <button key={q} className="btn-sm" onClick={() => setText(q)}>{q}</button>)}
          </div>
        </div>
      )}
      {!knowledge && <div className="card text-muted">Loading Helix Hub data…</div>}

      {chat.map((m, i) => (
        <div key={i} className="card mb-16" style={bubble(m)}>
          <div className="text-sm text-muted" style={{ marginBottom: 4 }}>{m.role === 'user' ? '🙋 You (as sent)' : '🤖 Helix'}</div>
          {m.role === 'user' ? <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div> : <Answer text={m.text} error={m.error} />}
          {m.role === 'assistant' && !m.error && (m.actions ?? []).some(a => helixCanOpen(a.tab)) && (
            <div style={{ marginTop: 10 }}>
              <div className="text-sm text-muted" style={{ marginBottom: 4 }}>📍 Where to do it</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {m.actions.filter(a => helixCanOpen(a.tab)).map(a => (
                  <button key={a.label} className="btn-primary btn-sm" onClick={() => doIt(a)} title="Opens the page with these details filled in">{a.label}</button>
                ))}
              </div>
            </div>
          )}
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
      <div ref={endRef} />
    </>
  );

  const input = knowledge && (
    <div className="card" style={compact ? { margin: 0, borderRadius: 0 } : { marginBottom: 16 }}>
      {full ? (
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="text-sm text-muted">This conversation has reached {MAX_QUESTIONS} questions.</span>
          <button className="btn-primary btn-sm" onClick={reset}>↺ Start a new conversation</button>
        </div>
      ) : (
        <>
          <textarea ref={inputRef} rows={2} value={text} maxLength={1000} disabled={!!busy || preview != null}
            placeholder="Ask about a payer, a denial code, an SOP or a payer change…"
            onChange={e => { setText(e.target.value); setBlocked(null); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} style={{ width: '100%' }} />
          <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <span className="text-sm text-muted" style={{ flex: '1 1 200px' }}>
              🔒 Never type patient names — Helix can’t tell a name from a word. Nothing here is saved.
            </span>
            {chat.length > 0 && <button className="btn-sm" onClick={reset} disabled={!!busy}>↺ New</button>}
            <button className="btn-primary" onClick={() => submit()} disabled={!!busy || !text.trim() || preview != null}>Ask</button>
          </div>
        </>
      )}
    </div>
  );

  if (!compact) return <>{list}{input}</>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>{list}</div>
      {input}
    </div>
  );
}
