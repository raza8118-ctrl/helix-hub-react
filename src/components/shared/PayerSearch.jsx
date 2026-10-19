import { useState, useEffect, useMemo, useRef, useId } from 'react';
import { S } from '../../lib/supabase';
import { searchPayers } from '../../lib/payers';

/**
 * Type-ahead payer picker. Searches names and aliases of active payers.
 * Pass `payers` to share already-loaded rows, or leave it out and it loads them.
 */
export default function PayerSearch({ payers: given, onSelect, placeholder = 'Search payer name or alias (e.g. BCBSTX)…', autoFocus = false }) {
  const [loaded, setLoaded] = useState(null);
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const [active, setActive] = useState(0);
  const boxRef  = useRef(null);
  const listId  = useId();

  useEffect(() => {
    if (given) return;
    S.get('payers').then(rows => setLoaded(rows ?? [])).catch(() => setLoaded([]));
  }, [given]);

  const pool = useMemo(() => (given ?? loaded ?? []).filter(p => p.active !== false), [given, loaded]);
  const results = useMemo(() => searchPayers(pool, query), [pool, query]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(p) {
    setQuery(p.name);
    setOpen(false);
    onSelect?.(p);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  const showList = open && query.trim() !== '';

  return (
    <div ref={boxRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        style={{ width: '100%', fontSize: 15, padding: '10px 12px' }}
      />
      {showList && (
        <div id={listId} role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)', maxHeight: 340, overflowY: 'auto',
        }}>
          {results.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-muted)' }}>
              {pool.length ? 'No payer matches that name or alias.' : 'No payers have been added yet.'}
            </div>
          )}
          {results.map((p, i) => (
            <div
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); choose(p); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '8px 12px', cursor: 'pointer',
                background: i === active ? 'var(--surface-2)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {[p.payer_type, p.matchedAlias && `matched “${p.matchedAlias}”`].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
