import { useState, useEffect, useMemo } from 'react';
import { GROUPS, PER_GROUP, getIndex, searchIndex, readRecent, pushRecent } from '../../lib/globalSearch';
import { setRecord } from '../../lib/navigate';

const ICONS = Object.fromEntries(GROUPS.map(g => [g.key, g.icon]));

/**
 * 🔍 Global search (roadmap 10.1): Ctrl+K / ⌘K or the top-bar button opens a search over pages and records the person
 * can open. Results open the page (App remounts it) with the record handed over through navigate.js. In the browser
 * only — nothing is sent or logged. tabs = this person's sidebar tabs; onOpen(tabId) switches page.
 */
export default function GlobalSearch({ user, tabs, onOpen }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(null);             // null = not loaded yet this session
  const [expanded, setExpanded] = useState(() => new Set());
  const [cursor, setCursor] = useState(0);

  // Ctrl+K / ⌘K anywhere
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The index loads the first time search opens (one shared load per session; ↻ asks for a fresh one)
  const needIndex = open && index === null;
  useEffect(() => {
    if (needIndex) getIndex(user, tabs).then(setIndex);
  }, [needIndex, user, tabs]);
  const loading = needIndex;
  function refresh() { setIndex(null); getIndex(user, tabs, true).then(setIndex); }
  const recent = useMemo(() => (open ? readRecent() : []), [open]);

  const groups = useMemo(() => (index ? searchIndex(index, query) : []), [index, query]);
  // The list shown, in order (for ↑ ↓): each group's first 6 (or all when expanded), then “Ask Helix”
  const flat = useMemo(() => {
    const rows = groups.flatMap(g => (expanded.has(g.group.key) ? g.items : g.items.slice(0, PER_GROUP)));
    const canAsk = tabs.some(t => t.id === 'wb_assistant');
    return query.trim() && canAsk ? [...rows, { key: 'ask', group: 'ask', title: `Ask Helix: “${query.trim()}”`, tab: 'wb_assistant', record: { question: query.trim() } }] : rows;
  }, [groups, expanded, query, tabs]);

  function close() { setOpen(false); setQuery(''); setExpanded(new Set()); setCursor(0); }
  function pick(it) {
    if (it.record) setRecord(it.tab, it.record);
    if (it.group !== 'ask') pushRecent(it);
    close();
    onOpen(it.tab);
  }
  function onKeyDown(e) {
    const list = query.trim() ? flat : recent;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && list[cursor]) { e.preventDefault(); pick(list[cursor]); }
  }

  const row = (it, i) => (
    <button key={it.key} type="button" onClick={() => pick(it)} onMouseEnter={() => setCursor(i)}
      style={{ display: 'flex', gap: 8, width: '100%', textAlign: 'left', padding: '7px 10px', border: 0, borderRadius: 6, cursor: 'pointer',
        background: i === cursor ? 'var(--surface-2, rgba(127,127,127,0.15))' : 'transparent', color: 'var(--text)' }}>
      <span>{it.group === 'ask' ? '🤖' : ICONS[it.group] ?? '•'}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
        {it.sub && <span className="text-sm text-muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sub}</span>}
      </span>
    </button>
  );

  let n = -1;
  return (
    <>
      <button type="button" className="btn-sm" onClick={() => setOpen(true)} title="Search Helix Hub (Ctrl+K)" aria-label="Search">
        🔍 <span className="text-sm text-muted">Search</span>
      </button>
      {open && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '10vh 16px 16px' }}>
          <div role="dialog" aria-label="Search Helix Hub" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 640, maxHeight: '75vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
            <div className="row" style={{ gap: 6, padding: 10, borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <span>🔍</span>
              <input autoFocus type="search" value={query} onChange={e => { setQuery(e.target.value); setCursor(0); setExpanded(new Set()); }} onKeyDown={onKeyDown}
                placeholder="Search payers, SOPs, codes, clients, queries, pages…" style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: 15 }} />
              <button type="button" className="btn-sm" onClick={refresh} disabled={loading} title="Refresh the search data">↻</button>
              <button type="button" className="btn-sm" onClick={close} aria-label="Close">Esc</button>
            </div>
            <div style={{ overflowY: 'auto', padding: 6 }}>
              {loading && !index && <div className="text-sm text-muted" style={{ padding: 10 }}>Loading Helix Hub data…</div>}
              {!query.trim() && recent.length > 0 && (
                <>
                  <div className="text-sm text-muted" style={{ padding: '6px 10px' }}>Recent</div>
                  {recent.map((it, i) => row(it, i))}
                </>
              )}
              {!query.trim() && !recent.length && index && <div className="text-sm text-muted" style={{ padding: 10 }}>Type a payer, client, SOP, denial code, Q-0042, E-0012 or a page name.</div>}
              {query.trim() && index && groups.map(g => {
                const shown = expanded.has(g.group.key) ? g.items : g.items.slice(0, PER_GROUP);
                return (
                  <div key={g.group.key} style={{ marginBottom: 6 }}>
                    <div className="text-sm text-muted" style={{ padding: '6px 10px' }}>{g.group.icon} {g.group.label}</div>
                    {shown.map(it => { n += 1; return row(it, n); })}
                    {g.total > shown.length && (
                      <button type="button" className="btn-sm" style={{ marginLeft: 10 }} onClick={() => setExpanded(s => new Set(s).add(g.group.key))}>Show all {g.total}</button>
                    )}
                  </div>
                );
              })}
              {query.trim() && index && !groups.length && <div className="text-sm text-muted" style={{ padding: 10 }}>No matches in Helix Hub.</div>}
              {query.trim() && flat.some(it => it.group === 'ask') && (
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>{row(flat[flat.length - 1], flat.length - 1)}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
