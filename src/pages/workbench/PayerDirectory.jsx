import { useState, useEffect, useMemo } from 'react';
import { S } from '../../lib/supabase';
import PayerSearch from '../../components/shared/PayerSearch';
import CopyButton from '../../components/shared/CopyButton';

/**
 * Payer Directory (roadmap 1.2): find a payer by name or alias, or browse A–Z.
 * Open to every signed-in user. The full payer card (contacts, payer IDs, limits,
 * forms) arrives in step 1.3.
 */
export default function PayerDirectory() {
  const [payers, setPayers]     = useState(null);   // null = loading / table missing
  const [error, setError]       = useState(false);
  const [selected, setSelected] = useState(null);
  const [typeFilter, setTypeFilter] = useState('ALL');

  useEffect(() => {
    S.get('payers').then(rows => {
      if (rows == null) setError(true);
      setPayers(rows ?? []);
    });
  }, []);

  const active = useMemo(() => (payers ?? []).filter(p => p.active !== false), [payers]);
  const types  = useMemo(() => [...new Set(active.map(p => p.payer_type).filter(Boolean))].sort(), [active]);
  const browse = useMemo(() => active
    .filter(p => typeFilter === 'ALL' || p.payer_type === typeFilter)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [active, typeFilter]);

  const byLetter = useMemo(() => {
    const groups = {};
    for (const p of browse) {
      const ch = (p.name ?? '').trim().charAt(0).toUpperCase();
      (groups[/[A-Z]/.test(ch) ? ch : '#'] ??= []).push(p);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [browse]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">📇 Payer Directory</div>
          <div className="page-subtitle">Find any payer by its name or a short name like “BCBSTX”.</div>
        </div>
      </div>

      <div className="card mb-16">
        {payers == null && <div className="text-muted" style={{ padding: 8 }}>Loading payers…</div>}
        {error && (
          <div className="text-muted" style={{ padding: 8 }}>
            The payer list isn’t set up yet. An admin needs to run the Clients &amp; Payers database update.
          </div>
        )}
        {payers != null && !error && (
          <PayerSearch payers={payers} onSelect={setSelected} autoFocus />
        )}
      </div>

      {selected && (
        <div className="card mb-16" style={{ borderLeft: '4px solid var(--accent)' }}>
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="card-title" style={{ fontSize: 18 }}>{selected.name}</span>
              <CopyButton value={selected.name} />
              {selected.payer_type && <span className="badge badge-blue">{selected.payer_type}</span>}
            </div>
            <button className="btn-sm" onClick={() => setSelected(null)}>✕ Close</button>
          </div>
          {(selected.aliases ?? []).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Also known as</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {selected.aliases.map(a => (
                  <span key={a} className="row" style={{ gap: 4, alignItems: 'center' }}>
                    <span className="badge badge-gray">{a}</span>
                    <CopyButton value={a} />
                  </span>
                ))}
              </div>
            </div>
          )}
          {selected.notes && <div className="text-sm" style={{ marginBottom: 10 }}>{selected.notes}</div>}
          <div className="text-sm text-muted">
            Contacts, payer IDs, filing limits and forms will appear here in the next update (roadmap step 1.3).
          </div>
        </div>
      )}

      {payers != null && !error && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">All payers ({browse.length})</div>
            {types.length > 0 && (
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ maxWidth: 220 }}>
                <option value="ALL">All types</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
          {browse.length === 0 && (
            <div className="text-muted" style={{ padding: 16, textAlign: 'center' }}>
              No payers yet. Admins and managers can add them in Clients &amp; Payers.
            </div>
          )}
          {byLetter.map(([letter, list]) => (
            <div key={letter} style={{ marginBottom: 12 }}>
              <div className="text-sm bold text-muted" style={{ margin: '6px 0 4px' }}>{letter}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {list.map(p => (
                  <button key={p.id} className="btn-sm" onClick={() => setSelected(p)}
                    style={selected?.id === p.id ? { background: 'var(--accent)', color: '#fff', border: 'none' } : undefined}
                    title={(p.aliases ?? []).join(', ')}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
