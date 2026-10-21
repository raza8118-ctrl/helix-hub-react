import { useState, useEffect } from 'react';
import { loadKnowledge, setHelixTabs } from '../../lib/assistant';
import HelixChat from './HelixChat';

const SEEN_KEY = 'hh_helix_chat_seen';   // per browser session: stop pulsing once opened
const seen = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };

const CSS = `
.helix-fab { position: fixed; right: 20px; bottom: 20px; z-index: 900; border: none; border-radius: 999px; padding: 12px 18px;
  background: var(--accent); color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; box-shadow: var(--shadow-md); }
.helix-fab:hover { background: var(--accent-hover); }
.helix-fab:focus-visible { outline: 3px solid var(--accent-dim); outline-offset: 2px; }
.helix-fab.pulse { animation: helixPulse 2s ease-in-out infinite; }
@keyframes helixPulse { 0%, 100% { box-shadow: var(--shadow-md), 0 0 0 0 rgba(124,58,237,0.55); } 50% { box-shadow: var(--shadow-md), 0 0 0 12px rgba(124,58,237,0); } }
.helix-panel { position: fixed; right: 20px; bottom: 20px; z-index: 950; width: 420px; height: min(640px, calc(100vh - 40px));
  display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-lg, 16px);
  box-shadow: var(--shadow-md); overflow: hidden; }
.helix-panel-head { display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
@media (max-width: 640px) {
  .helix-fab { right: 16px; bottom: 16px; }
  .helix-panel { inset: 0; width: auto; height: auto; border-radius: 0; border: none; }
}
@media (prefers-reduced-motion: reduce) { .helix-fab.pulse { animation: none; } }
`;

/**
 * 🤖 Floating "Ask" button (bottom-right, every page except Ask Helix) → a chat panel with the same conversation as the
 * Ask Helix page (memory only). Full screen on phones. Shown only to users who have the Ask Helix page.
 */
export default function HelixLauncher({ user, tabs, activeTab }) {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(() => !seen());
  const [knowledge, setKnowledge] = useState(null);
  const allowed = tabs.some(t => t.id === 'wb_assistant');

  const tabIds = tabs.map(t => t.id).join(',');
  useEffect(() => { setHelixTabs(tabIds.split(',')); }, [tabIds]);

  // Reference data loads the first time the panel opens, then stays for the session
  useEffect(() => {
    let alive = true;
    if (open && !knowledge) loadKnowledge(user).then(k => { if (alive) setKnowledge(k); });
    return () => { alive = false; };
  }, [open, knowledge, user]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!allowed || activeTab === 'wb_assistant') return null;

  function show() {
    setOpen(true);
    setPulse(false);
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private window: keeps pulsing until opened */ }
  }

  function fullPage() {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('helix:open-page', { detail: 'wb_assistant' }));
  }

  return (
    <>
      <style>{CSS}</style>
      {!open && (
        <button className={`helix-fab${pulse ? ' pulse' : ''}`} onClick={show} aria-label="Ask Helix" title="Ask Helix">🤖 Ask</button>
      )}
      {open && (
        <div className="helix-panel" role="dialog" aria-label="Ask Helix">
          <div className="helix-panel-head">
            <span className="bold" style={{ flex: 1 }}>🤖 Ask Helix</span>
            <button className="btn-sm" onClick={fullPage} title="Open the full Ask Helix page">⤢ Open full page</button>
            <button className="btn-sm" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <HelixChat user={user} knowledge={knowledge} compact onLeave={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
