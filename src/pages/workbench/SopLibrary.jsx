import { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/supabase';
import { hasAccess } from '../../lib/access';
import { loadSopLibrary, buildSopTree, countSops, statusOf, STARTER_CATEGORIES, missingStarterSoftware, peekSopLibrarySearch, clearSopLibrarySearch } from '../../lib/sops';
import { loadSopVersionMeta, versionStates, pendingAcknowledgements } from '../../lib/sopVersions';
import { SopEditModal, StarterSoftwareModal } from './SopEditors';
import { peekRecord, clearRecord } from '../../lib/navigate';
import SopPage from './SopPage';
import { toggleSopActive, moveSopItem, addStarterCategories } from './sopActions';
import CopyButton from '../../components/shared/CopyButton';
import { Button } from '../../components/ui';
import { masterGet, mergeSopLibraries, inMasterWorkspace, isMasterRow } from '../../lib/masterLibrary';
import { sopAsVersion } from '../../lib/sopVersions';
import LibraryBadge from '../../components/shared/LibraryBadge';

// Master Library SOPs as readers see them: active, not client-specific, each showing its current published version
async function loadMasterSops() {
  const [categories, software, tasks, sops, versions] = await Promise.all(
    ['sop_categories', 'sop_software', 'sop_tasks', 'sops', 'sop_versions'].map(t => masterGet(t)));
  if ([categories, software, tasks, sops].some(x => x == null)) return null;
  const bySop = {};
  (versions ?? []).forEach(v => { (bySop[v.sop_id] ??= []).push(v); });
  const view = sops.filter(s => s.active !== false && s.client_id == null).flatMap(s => {
    if (!bySop[s.id]?.length) return s.status === 'published' ? [s] : [];
    const { current } = versionStates(bySop[s.id]);
    return current ? [{ ...sopAsVersion(s, current), version: undefined, status: 'published' }] : [];
  });
  const active = r => r.active !== false;
  return { categories: categories.filter(active), software: software.filter(active), tasks: tasks.filter(active), sops: view, clients: [] };
}

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const inactiveStyle = row => row.active === false ? { opacity: 0.55 } : undefined;

/**
 * SOP Library (roadmap 3.1): Category → Software → Task → SOP.
 * Everyone sees published SOPs; "Edit SOP Library" holders also see drafts and can add/edit/reorder.
 * Clicking an SOP opens its full page with the standard template (3.2).
 * 3.4: readers see the current published version of each SOP; client filter; "to acknowledge" banner.
 */
export default function SopLibrary({ user }) {
  const canEdit = hasAccess(user, 'sops_edit');
  const [lib, setLib]           = useState(undefined);   // undefined = loading, null = tables missing
  const [users, setUsers]       = useState([]);
  const [query, setQuery]       = useState(() => peekSopLibrarySearch() || peekRecord('wb_sops')?.query || '');   // 6.6 How-to / 10.1 search
  const [categoryId, setCategoryId] = useState('ALL');
  const [status, setStatus]     = useState('ALL');
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen]         = useState(() => new Set());   // expanded software ids
  const [editor, setEditor]     = useState(null);              // { level, row, parentId }
  const [starterSoftware, setStarterSoftware] = useState(false);   // "Add standard software" pop-up (3.7)
  const [openSopId, setOpenSopId] = useState(null);            // SOP shown as a full page (3.2)
  const [meta, setMeta]         = useState(null);              // 3.4 versions + my reads; null = not set up
  const [clientId, setClientId] = useState('ALL');
  const [masterLib, setMasterLib] = useState(null);           // Master Library SOPs (PO 2026-11-10); null = not shown
  useEffect(() => {
    let alive = true;
    if (!inMasterWorkspace()) loadMasterSops().then(m => { if (alive) setMasterLib(m); });
    return () => { alive = false; };
  }, []);

  // Library + version facts together; lib.versionsReady tells the editors whether 3.4 is set up
  const empId = user.emp_id;
  const fetchAll = id => Promise.all([loadSopLibrary(), loadSopVersionMeta({ emp_id: id })]);
  const applyAll = ([l, m]) => { setLib(l ? { ...l, versionsReady: m != null } : l); setMeta(m); };
  const load = () => fetchAll(empId).then(applyAll);
  useEffect(() => { clearSopLibrarySearch(); clearRecord('wb_sops'); }, []);
  useEffect(() => {
    Promise.all([loadSopLibrary(), loadSopVersionMeta({ emp_id: empId })])
      .then(([l, m]) => { setLib(l ? { ...l, versionsReady: m != null } : l); setMeta(m); });
    db('users').select('emp_id,name').then(({ data }) =>
      setUsers((data ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))));
  }, [empId]);

  // What readers see: each SOP's current published version (title/summary from it). Editors see the working copies.
  const viewLib = useMemo(() => {
    if (!lib || canEdit || !meta) return lib;
    const bySop = {};
    meta.versions.forEach(v => { (bySop[v.sop_id] ??= []).push(v); });
    const sops = lib.sops.flatMap(s => {
      if (!bySop[s.id]?.length) return s.status === 'published' ? [s] : [];   // published before versions existed
      const { current } = versionStates(bySop[s.id]);
      return current ? [{ ...s, title: current.title ?? s.title, summary: current.summary ?? s.summary, status: 'published' }] : [];
    });
    return { ...lib, sops };
  }, [lib, meta, canEdit]);

  const pending = useMemo(() => viewLib && meta
    ? pendingAcknowledgements(viewLib.sops.filter(s => s.active !== false), meta, user) : [], [viewLib, meta, user]);
  const pendingIds = useMemo(() => new Set(pending.map(p => p.sop.id)), [pending]);
  const clientName = useMemo(() => Object.fromEntries((lib?.clients ?? []).map(c => [c.id, c.name])), [lib]);

  const names = useMemo(() => Object.fromEntries(users.map(u => [u.emp_id, u.name ?? u.emp_id])), [users]);
  // What the list shows: the company's SOPs + the Master Library's (company version first where both have the same SOP)
  const libOn = !!masterLib;
  const displayLib = useMemo(() => (viewLib && masterLib ? mergeSopLibraries(viewLib, masterLib) : viewLib), [viewLib, masterLib]);
  const tree = useMemo(() => displayLib ? buildSopTree(displayLib, {
    query, categoryId, status, clientId, showInactive: canEdit && showInactive, canSeeDrafts: canEdit,
  }) : [], [displayLib, query, categoryId, status, clientId, showInactive, canEdit]);
  const searching = query.trim() !== '';
  const missingStarters = lib && STARTER_CATEGORIES.some(n => !lib.categories.some(c => c.name.toLowerCase() === n.toLowerCase()));
  const missingSoftware = lib ? missingStarterSoftware(lib) : [];

  const toggleOpen = id => setOpen(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const edit = (level, row = null, parentId = null) => setEditor({ level, row, parentId });
  const afterChange = changed => { if (changed) load(); };

  // Editor-only controls shown beside every item: ▲ ▼ ✎ and make inactive / reactivate
  function controls({ level, row, list, index, addLevel, addLabel }) {
    if (!canEdit || isMasterRow(row)) return null;   // Master Library items are read-only here
    return (
      <span className="fg-row-actions" onClick={e => e.stopPropagation()}>
        {addLevel && <Button size="xs" onClick={() => edit(addLevel, null, row.id)}>+ {addLabel}</Button>}
        <Button size="xs" title="Move up" aria-label="Move up" disabled={index === 0}
          onClick={async () => afterChange(await moveSopItem(level, list, index, -1, user))}>▲</Button>
        <Button size="xs" title="Move down" aria-label="Move down" disabled={index === list.length - 1}
          onClick={async () => afterChange(await moveSopItem(level, list, index, 1, user))}>▼</Button>
        <Button size="xs" title="Edit" aria-label="Edit" onClick={() => edit(level, row)}>✎</Button>
        <Button size="xs" title={row.active === false ? 'Reactivate' : 'Make inactive'} aria-label={row.active === false ? 'Reactivate' : 'Make inactive'}
          onClick={async () => afterChange(await toggleSopActive(level, row, user))}>
          {row.active === false ? '↺' : '⊘'}
        </Button>
      </span>
    );
  }

  // A Master Library SOP: read-only page from the master (no read tracking here)
  const openMaster = displayLib && openSopId != null && String(openSopId).startsWith('m-') ? displayLib.sops.find(s => s.id === openSopId) : null;
  if (openMaster) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <SopPage key={openMaster.id} sop={openMaster._orig ? { ...openMaster._orig, ...openMaster, id: openMaster._rawId, task_id: openMaster._orig.task_id } : openMaster}
          lib={masterLib} meta={null} names={{}} user={user} canEdit={false} library libBadge="master"
          onBack={() => setOpenSopId(null)} onChanged={() => {}} onOpenSop={() => {}} />
      </div>
    );
  }

  // Readers may only open SOPs they can see in the list (published, active); the page gets the raw row
  const openSop = lib && openSopId != null ? lib.sops.find(s => s.id === openSopId) : null;
  const openStandard = openSop && displayLib ? displayLib.sops.find(s => s.id === openSop.id && !isMasterRow(s))?._master : null;
  if (openSop && (canEdit || viewLib.sops.some(s => s.id === openSop.id && s.active !== false))) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <SopPage key={openSop.id} sop={openSop} lib={lib} meta={meta} names={names} user={user} canEdit={canEdit}
          libBadge={libOn ? (openStandard ? 'override' : 'company') : null}
          onBack={() => setOpenSopId(null)} onChanged={load} onOpenSop={setOpenSopId} />
        {openStandard && (
          <div className="lib-standard-page">
            <SopPage key={openStandard.id} sop={{ ...openStandard._orig, ...openStandard, id: openStandard._rawId, task_id: openStandard._orig.task_id }}
              lib={masterLib} meta={null} names={{}} user={user} canEdit={false} library hideBack libBadge="standard"
              onBack={() => {}} onChanged={() => {}} onOpenSop={() => {}} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fg-page nb-page">
      {/* Intro + editor actions (the page title is in the top bar) */}
      <div className="fg-bar">
        <span className="fg-date">Step-by-step guides, organised by software and task.</span>
        {canEdit && lib && (
          <div className="fg-actions">
            {missingStarters && (
              <Button size="sm" onClick={async () => afterChange(await addStarterCategories(lib, user))}>
                Add standard categories
              </Button>
            )}
            {missingSoftware.length > 0 && (
              <Button size="sm" onClick={() => setStarterSoftware(true)}>
                Add standard software ({missingSoftware.length})
              </Button>
            )}
            <Button size="sm" onClick={() => edit('category')}>+ Category</Button>
          </div>
        )}
      </div>

      {lib === undefined && <div className="card text-muted">Loading SOP Library…</div>}
      {lib === null && (
        <div className="card text-muted">
          The SOP Library isn’t set up yet. An admin needs to run the SOP Library database update
          (<code>20261019d_sop_library.sql</code>) in Supabase.
        </div>
      )}

      {lib && pending.length > 0 && (
        <div className="card sop-ack">
          <div className="bold sop-ack-t">
            📌 You have {pending.length} SOP{pending.length > 1 ? 's' : ''} to acknowledge
          </div>
          <div className="fg-row-actions">
            {pending.map(p => (
              <Button key={p.sop.id} size="sm" onClick={() => setOpenSopId(p.sop.id)}>
                {p.sop.title} (v{p.version.version_no}) ›
              </Button>
            ))}
          </div>
        </div>
      )}

      {lib && (
        <>
          <div className="card sop-filters">
            <div className="nb-search">
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
                placeholder="Search software, task or SOP (e.g. “Waystar”, “claim status”)" aria-label="Search SOPs" />
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)} aria-label="Category">
                <option value="ALL">All categories</option>
                {(displayLib ?? lib).categories.filter(c => c.active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                  .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {lib.versionsReady && lib.clients.length > 0 && (
                <select value={clientId} onChange={e => setClientId(e.target.value)} aria-label="Client"
                  title="A client shows its own SOPs plus the common ones">
                  <option value="ALL">All clients</option>
                  {lib.clients.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {canEdit && (
                <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
                  <option value="ALL">All statuses</option>
                  <option value="published">Published</option>
                  <option value="draft">Drafts</option>
                </select>
              )}
              {canEdit && (
                <label className="row text-sm text-muted wl-closed-toggle">
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show inactive
                </label>
              )}
            </div>
          </div>

          {tree.length === 0 && (
            <div className="card text-muted fg-empty">
              {searching ? 'Nothing matches your search.'
                : canEdit ? 'No categories yet — add one to get started.' : 'No SOPs have been added yet.'}
            </div>
          )}

          {tree.map((cat, ci) => (
            <div key={cat.id} className="card mb-16" style={inactiveStyle(cat)}>
              <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="card-title">
                  {cat.name} <span className="text-sm text-muted">· {cat.software.length} software · {countSops(cat)} SOPs</span>
                  {cat.active === false && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Inactive</span>}
                  {isMasterRow(cat) && <LibraryBadge kind="master" />}
                </div>
                {controls({ level: 'category', row: cat, list: tree, index: ci, addLevel: 'software', addLabel: 'Software' })}
              </div>

              {cat.software.length === 0 && (
                <div className="text-sm text-muted" style={{ padding: '4px 0' }}>No software in this category yet.</div>
              )}

              {cat.software.map((sw, si) => {
                const expanded = searching || open.has(sw.id);
                return (
                  <div key={sw.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', ...inactiveStyle(sw) }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => toggleOpen(sw.id)} role="button" aria-expanded={expanded}>
                      <span style={{ width: 14 }}>{expanded ? '▾' : '▸'}</span>
                      <span className="bold">{sw.name}</span>
                      {sw.vendor && <span className="text-sm text-muted">{sw.vendor}</span>}
                      <span className="text-sm text-muted">· {sw.tasks.length} tasks · {countSops(sw)} SOPs</span>
                      {sw.active === false && <span className="badge badge-gray">Inactive</span>}
                      {isMasterRow(sw) && <LibraryBadge kind="master" />}
                      {sw.portal_url && (
                        <span className="row" style={{ gap: 4 }} onClick={e => e.stopPropagation()}>
                          <a className="btn-sm" href={sw.portal_url} target="_blank" rel="noopener noreferrer">Open login page ↗</a>
                          <CopyButton value={sw.portal_url} label="Copy link" />
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto' }}>
                        {controls({ level: 'software', row: sw, list: cat.software, index: si, addLevel: 'task', addLabel: 'Task' })}
                      </span>
                    </div>

                    {expanded && (
                      <div style={{ paddingLeft: 22, marginTop: 6 }}>
                        {sw.notes && <div className="text-sm text-muted" style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}>{sw.notes}</div>}
                        {sw.tasks.length === 0 && <div className="text-sm text-muted">No tasks yet.</div>}
                        {sw.tasks.map((t, ti) => (
                          <div key={t.id} style={{ marginBottom: 10, ...inactiveStyle(t) }}>
                            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span className="bold text-sm">{t.name}</span>
                              {t.active === false && <span className="badge badge-gray">Inactive</span>}
                              {isMasterRow(t) && <LibraryBadge kind="master" />}
                              <span style={{ marginLeft: 'auto' }}>
                                {controls({ level: 'task', row: t, list: sw.tasks, index: ti, addLevel: 'sop', addLabel: 'SOP' })}
                              </span>
                            </div>
                            {t.sops.length === 0 && <div className="text-sm text-muted" style={{ paddingLeft: 12 }}>No SOPs yet.</div>}
                            {t.sops.map((s, i) => (
                              <div key={s.id} className="row" style={{
                                gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0 6px 12px',
                                borderLeft: '3px solid var(--accent)', marginTop: 4, ...inactiveStyle(s),
                                ...(s.client_id != null ? { background: 'var(--surface-2)', borderRadius: '0 6px 6px 0' } : null),
                              }}>
                                <div style={{ flex: '1 1 240px', minWidth: 0, cursor: 'pointer' }} role="button" tabIndex={0}
                                  title="Open this SOP" onClick={() => setOpenSopId(s.id)}
                                  onKeyDown={e => { if (e.key === 'Enter') setOpenSopId(s.id); }}>
                                  <div className="text-sm bold" style={{ color: 'var(--accent)' }}>📄 {s.title} ›</div>
                                  {s.summary && <div className="text-sm text-muted">{s.summary}</div>}
                                  <div className="text-sm text-muted">
                                    {s.owner && !isMasterRow(s) ? `Owner: ${names[s.owner] ?? s.owner} · ` : ''}Updated {fmtDate(s.updated_at)}
                                  </div>
                                </div>
                                {libOn && <LibraryBadge kind={isMasterRow(s) ? 'master' : s._master ? 'override' : 'company'} />}
                                {s.client_id != null && <span className="badge badge-blue">Client: {clientName[s.client_id] ?? '?'}</span>}
                                {pendingIds.has(s.id) && <span className="badge badge-orange">To acknowledge</span>}
                                {canEdit && !isMasterRow(s) && <span className={`badge ${statusOf(s.status).badge}`}>{statusOf(s.status).label}</span>}
                                {s.active === false && <span className="badge badge-gray">Inactive</span>}
                                {controls({ level: 'sop', row: s, list: t.sops, index: i })}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {editor && (
        <SopEditModal {...editor} lib={lib} users={users} user={user}
          onClose={() => setEditor(null)}
          onSaved={() => { if (editor.parentId && editor.level === 'task') setOpen(s => new Set(s).add(editor.parentId)); setEditor(null); load(); }} />
      )}
      {starterSoftware && lib && (
        <StarterSoftwareModal lib={lib} user={user} onClose={() => setStarterSoftware(false)}
          onSaved={() => { setStarterSoftware(false); load(); }} />
      )}
    </div>
  );
}
