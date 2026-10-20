import { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/supabase';
import { hasAccess } from '../../lib/access';
import { loadSopLibrary, buildSopTree, countSops, statusOf, STARTER_CATEGORIES } from '../../lib/sops';
import { SopEditModal } from './SopEditors';
import SopPage from './SopPage';
import { toggleSopActive, moveSopItem, addStarterCategories } from './sopActions';
import CopyButton from '../../components/shared/CopyButton';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const inactiveStyle = row => row.active === false ? { opacity: 0.55 } : undefined;

/**
 * SOP Library (roadmap 3.1): Category → Software → Task → SOP.
 * Everyone sees published SOPs; "Edit SOP Library" holders also see drafts and can add/edit/reorder.
 * Clicking an SOP opens its full page with the standard template (3.2).
 */
export default function SopLibrary({ user }) {
  const canEdit = hasAccess(user, 'sops_edit');
  const [lib, setLib]           = useState(undefined);   // undefined = loading, null = tables missing
  const [users, setUsers]       = useState([]);
  const [query, setQuery]       = useState('');
  const [categoryId, setCategoryId] = useState('ALL');
  const [status, setStatus]     = useState('ALL');
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen]         = useState(() => new Set());   // expanded software ids
  const [editor, setEditor]     = useState(null);              // { level, row, parentId }
  const [openSopId, setOpenSopId] = useState(null);            // SOP shown as a full page (3.2)

  const load = () => loadSopLibrary().then(setLib);
  useEffect(() => {
    loadSopLibrary().then(setLib);
    db('users').select('emp_id,name').then(({ data }) =>
      setUsers((data ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))));
  }, []);

  const names = useMemo(() => Object.fromEntries(users.map(u => [u.emp_id, u.name ?? u.emp_id])), [users]);
  const tree = useMemo(() => lib ? buildSopTree(lib, {
    query, categoryId, status, showInactive: canEdit && showInactive, canSeeDrafts: canEdit,
  }) : [], [lib, query, categoryId, status, showInactive, canEdit]);
  const searching = query.trim() !== '';
  const missingStarters = lib && STARTER_CATEGORIES.some(n => !lib.categories.some(c => c.name.toLowerCase() === n.toLowerCase()));

  const toggleOpen = id => setOpen(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const edit = (level, row = null, parentId = null) => setEditor({ level, row, parentId });
  const afterChange = changed => { if (changed) load(); };

  // Editor-only controls shown beside every item: ▲ ▼ ✎ and make inactive / reactivate
  function controls({ level, row, list, index, addLevel, addLabel }) {
    if (!canEdit) return null;
    return (
      <span className="row" style={{ gap: 4, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
        {addLevel && <button className="btn-sm" onClick={() => edit(addLevel, null, row.id)}>+ {addLabel}</button>}
        <button className="btn-sm" title="Move up" disabled={index === 0}
          onClick={async () => afterChange(await moveSopItem(level, list, index, -1, user))}>▲</button>
        <button className="btn-sm" title="Move down" disabled={index === list.length - 1}
          onClick={async () => afterChange(await moveSopItem(level, list, index, 1, user))}>▼</button>
        <button className="btn-sm" title="Edit" onClick={() => edit(level, row)}>✎</button>
        <button className="btn-sm" title={row.active === false ? 'Reactivate' : 'Make inactive'}
          onClick={async () => afterChange(await toggleSopActive(level, row, user))}>
          {row.active === false ? '↺' : '⊘'}
        </button>
      </span>
    );
  }

  const openSop = lib && openSopId != null ? lib.sops.find(s => s.id === openSopId) : null;
  if (openSop && (canEdit || (openSop.status === 'published' && openSop.active !== false))) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <SopPage sop={openSop} lib={lib} names={names} user={user} canEdit={canEdit}
          onBack={() => setOpenSopId(null)} onChanged={load} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">📚 SOP Library</div>
          <div className="page-subtitle">Step-by-step guides, organised by software and task.</div>
        </div>
        {canEdit && lib && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {missingStarters && (
              <button className="btn-sm" onClick={async () => afterChange(await addStarterCategories(lib, user))}>
                Add standard categories
              </button>
            )}
            <button className="btn-sm" onClick={() => edit('category')}>+ Category</button>
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

      {lib && (
        <>
          <div className="card mb-16">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
                placeholder="Search software, task or SOP (e.g. “Waystar”, “claim status”)"
                style={{ flex: '1 1 260px', minWidth: 0 }} />
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="ALL">All categories</option>
                {lib.categories.filter(c => c.active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                  .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {canEdit && (
                <select value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 160 }}>
                  <option value="ALL">All statuses</option>
                  <option value="published">Published</option>
                  <option value="draft">Drafts</option>
                </select>
              )}
              {canEdit && (
                <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show inactive
                </label>
              )}
            </div>
          </div>

          {tree.length === 0 && (
            <div className="card text-muted" style={{ textAlign: 'center' }}>
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
                              <span style={{ marginLeft: 'auto' }}>
                                {controls({ level: 'task', row: t, list: sw.tasks, index: ti, addLevel: 'sop', addLabel: 'SOP' })}
                              </span>
                            </div>
                            {t.sops.length === 0 && <div className="text-sm text-muted" style={{ paddingLeft: 12 }}>No SOPs yet.</div>}
                            {t.sops.map((s, i) => (
                              <div key={s.id} className="row" style={{
                                gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0 6px 12px',
                                borderLeft: '3px solid var(--accent)', marginTop: 4, ...inactiveStyle(s),
                              }}>
                                <div style={{ flex: '1 1 240px', minWidth: 0, cursor: 'pointer' }} role="button" tabIndex={0}
                                  title="Open this SOP" onClick={() => setOpenSopId(s.id)}
                                  onKeyDown={e => { if (e.key === 'Enter') setOpenSopId(s.id); }}>
                                  <div className="text-sm bold" style={{ color: 'var(--accent)' }}>📄 {s.title} ›</div>
                                  {s.summary && <div className="text-sm text-muted">{s.summary}</div>}
                                  <div className="text-sm text-muted">
                                    {s.owner ? `Owner: ${names[s.owner] ?? s.owner} · ` : ''}Updated {fmtDate(s.updated_at)}
                                  </div>
                                </div>
                                {canEdit && <span className={`badge ${statusOf(s.status).badge}`}>{statusOf(s.status).label}</span>}
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
    </div>
  );
}
