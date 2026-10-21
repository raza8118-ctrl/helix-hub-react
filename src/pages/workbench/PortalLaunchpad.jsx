import { useState, useEffect, useMemo } from 'react';
import { hasAccess } from '../../lib/access';
import {
  PORTAL_GROUPS, loadLaunchpad, buildTiles, sortTiles, readStars, writeStars, needsRecheck,
  verifyPortal, setPortalActive, movePortal,
} from '../../lib/portals';
import { openSopLibrary } from '../../lib/sops';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';
import PortalEditor from './PortalEditor';

const CLIENT_KEY = 'hh_portal_client';
const readClient = () => { try { return localStorage.getItem(CLIENT_KEY) ?? ''; } catch { return ''; } };
const writeClient = id => { try { if (id) localStorage.setItem(CLIENT_KEY, id); else localStorage.removeItem(CLIENT_KEY); } catch { /* blocked */ } };
const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;

/**
 * 🚀 Portal launchpad (roadmap 6.6): pick a client → every login page its work needs (client software, payer portals,
 * other links) with Open / Copy / How-to. Managers (“Manage portal links”) set each client's links up.
 * Never stores passwords; opening a portal is not logged.
 */
export default function PortalLaunchpad({ user, ctx }) {
  const canEdit = hasAccess(user, 'portals_edit');
  const canSeeDrafts = hasAccess(user, 'sops_edit');
  const [data, setData] = useState(undefined);           // undefined = loading
  const [clientId, setClientId] = useState(readClient);
  const [query, setQuery] = useState('');
  const [stars, setStars] = useState(() => readStars(user.emp_id));
  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState(null);           // { row } — row null = new link
  const [busy, setBusy] = useState(false);

  const reload = () => loadLaunchpad().then(setData);
  useEffect(() => {
    let alive = true;
    loadLaunchpad().then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, []);

  const client = clientId ? ctx.clients.find(c => String(c.id) === clientId) : null;
  const ready = data && data.rows != null;
  const cid = client ? client.id : null;

  const tiles = useMemo(() => {
    if (!data) return [];
    const all = buildTiles(data, ctx.payers, { clientId: cid, showInactive: canEdit && showInactive, canSeeDrafts });
    const q = query.trim().toLowerCase();
    const found = q ? all.filter(t => [t.name, t.sub, t.note].some(x => (x ?? '').toLowerCase().includes(q))) : all;
    return sortTiles(found, stars);
  }, [data, ctx.payers, cid, canEdit, showInactive, canSeeDrafts, query, stars]);

  function pickClient(id) { setClientId(id); writeClient(id); }
  function toggleStar(key) {
    const next = new Set(stars);
    if (next.has(key)) next.delete(key); else next.add(key);
    setStars(next);
    writeStars(user.emp_id, next);
  }

  // Manager order of one group's links in this view (this client's + all-client links)
  const groupRows = group => (data?.rows ?? [])
    .filter(r => r.kind === group && (r.client_id == null || r.client_id === cid) && (r.active !== false || showInactive))
    .sort(byOrder);

  async function run(fn) { setBusy(true); await fn(); await reload(); setBusy(false); }
  const move = (row, dir) => run(() => { const list = groupRows(row.kind); return movePortal(list, list.findIndex(r => r.id === row.id), dir); });
  const verify = row => run(() => verifyPortal(row, user));
  async function toggleActive(row) {
    if (row.active !== false && !await confirmDialog({ title: 'Turn this link off?', message: 'It disappears from the launchpad. You can turn it back on with “Show turned-off links”.', tone: 'warning', confirmText: 'Turn off' })) return;
    run(() => setPortalActive(row, row.active === false, user));
  }

  const nextOrder = Math.max(-1, ...(data?.rows ?? []).map(r => r.sort_order ?? 0)) + 1;
  const clientOwn = ready ? tiles.filter(t => !t.allClients).length : 0;

  function tile(t) {
    const r = t.row;
    const list = r ? groupRows(r.kind) : [];
    const i = r ? list.findIndex(x => x.id === r.id) : -1;
    const starred = stars.has(t.key);
    return (
      <div key={t.key} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, opacity: r?.active === false ? 0.55 : 1 }}>
        <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
          <button type="button" className="btn-icon" onClick={() => toggleStar(t.key)} aria-pressed={starred}
            title={starred ? 'Remove from favourites' : 'Add to favourites (shown first)'} aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}>
            {starred ? '⭐' : '☆'}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bold" style={{ overflowWrap: 'anywhere' }}>{t.name}</div>
            {t.sub && <div className="text-sm text-muted">{t.sub}</div>}
          </div>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {t.allClients && client && <span className="badge badge-gray">All clients</span>}
          {r && !t.standard && t.row.kind !== 'custom' && <span className="badge badge-blue">Client link</span>}
          {r?.active === false && <span className="badge badge-gray">Turned off</span>}
          {canEdit && r && needsRecheck(r) && <span className="badge badge-yellow">{r.verified_at ? 'Re-check link' : 'Not checked yet'}</span>}
        </div>
        {t.note && <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>🔑 {t.note}</div>}
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}>
          {t.url
            ? <a className="btn-primary" href={t.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
            : <span className="text-sm text-muted">No link yet</span>}
          {t.url && <CopyButton value={t.url} label="Copy link" />}
          {t.sopCount > 0 && (
            <button type="button" className="btn-sm" onClick={() => openSopLibrary(t.name)} title="Open this software's SOPs in the SOP Library">
              📚 How-to ({t.sopCount})
            </button>
          )}
        </div>
        {r?.verified_at && <div className="text-sm text-muted">✓ Link checked {fmtDate(r.verified_at)}</div>}
        {canEdit && r && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <button className="btn-sm" disabled={busy} onClick={() => setEditor({ row: r })}>✏️ Edit</button>
            <button className="btn-sm" disabled={busy} onClick={() => verify(r)} title="I opened it and it works">✓ Link checked</button>
            <button className="btn-sm" disabled={busy || i <= 0} onClick={() => move(r, -1)} aria-label="Move up">↑</button>
            <button className="btn-sm" disabled={busy || i < 0 || i >= list.length - 1} onClick={() => move(r, 1)} aria-label="Move down">↓</button>
            <button className="btn-sm" disabled={busy} onClick={() => toggleActive(r)}>{r.active === false ? 'Turn on' : 'Turn off'}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}><label>Client</label>
            <select value={client ? clientId : ''} onChange={e => pickClient(e.target.value)}>
              <option value="">— Choose a client —</option>
              {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}><label>Search</label>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Portal, software or payer name…" />
          </div>
          {canEdit && ready && <button className="btn-primary" onClick={() => setEditor({ row: null })}>+ Add link</button>}
        </div>
        {canEdit && ready && (
          <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginTop: 8 }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show turned-off links
          </label>
        )}
        <p className="text-sm text-muted" style={{ margin: '8px 0 0' }}>
          🔒 Helix Hub never stores passwords. Portals open in a new tab; ⭐ favourites are kept on this computer only.
        </p>
      </div>

      {data === undefined && <div className="card text-muted">Loading…</div>}

      {data && !ready && (
        <div className="card mb-16 text-sm text-muted">
          Showing every software login link from the SOP Library and every payer portal from the Payer Directory.
          Links per client need the portal launchpad database update (<code>20261021l_client_portals.sql</code>).
        </div>
      )}

      {ready && !client && (
        <div className="card mb-16 text-sm text-muted">Choose a client to see its own portals. Links shown below are for all clients.</div>
      )}
      {ready && client && clientOwn === 0 && !query && (
        <div className="card mb-16 text-sm text-muted">
          No portals set up for {client.name} yet.{canEdit ? ' Use “+ Add link” to add its software and payer portals.' : ' Ask a manager to set them up.'}
        </div>
      )}

      {data && PORTAL_GROUPS.map(g => {
        const list = tiles.filter(t => t.group === g.value);
        if (!list.length) return null;
        return (
          <div key={g.value} className="card mb-16">
            <div className="card-header">
              <div className="card-title">{g.icon} {g.label} <span className="text-sm text-muted">· {list.length} · {g.hint}</span></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {list.map(tile)}
            </div>
          </div>
        );
      })}

      {data && tiles.length === 0 && (query || !ready) && (
        <div className="card text-muted" style={{ textAlign: 'center' }}>
          {query ? 'Nothing matches your search.' : 'No login links yet — add them in the SOP Library (software) or the Payer Directory (portal link).'}
        </div>
      )}

      {editor && (
        <PortalEditor row={editor.row} clientId={cid} data={data} ctx={ctx} user={user} nextOrder={nextOrder}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); reload(); }} />
      )}
    </div>
  );
}
