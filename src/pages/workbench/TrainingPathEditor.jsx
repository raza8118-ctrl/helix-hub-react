import { useState } from 'react';
import { TEAMS } from '../../lib/constants';
import {
  ITEM_KINDS, kindOf, itemTitle, pathItems, pathDays, savePath, copyPath, setPathActive, saveItem, moveItem,
} from '../../lib/training';
import TrainingAssign from './TrainingAssign';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

// Add / edit a path's name, description, team and number of days
function PathModal({ path, user, onClose, onSaved }) {
  const [v, setV] = useState({
    name: path?.name ?? '', description: path?.description ?? '', team: path?.team ?? '', days: path?.days ?? 5,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!v.name.trim()) return setError('Please give the path a name.');
    const days = Math.max(1, Math.min(60, Number(v.days) || 1));
    setSaving(true);
    const row = await savePath(path, { name: v.name.trim(), description: v.description.trim() || null, team: v.team || null, days }, user);
    setSaving(false);
    if (!row) return setError('Could not save. Please try again.');
    onSaved(row);
  }

  return (
    <Modal title={path ? 'Edit learning path' : 'New learning path'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="field"><label>Name *</label>
          <input type="text" value={v.name} placeholder="e.g. New AR joiner – Week 1" onChange={e => { setV({ ...v, name: e.target.value }); setError(''); }} />
        </div>
        <div className="field"><label>Description</label>
          <textarea rows={2} value={v.description} placeholder="Who it is for and what they will be able to do"
            onChange={e => setV({ ...v, description: e.target.value })} />
        </div>
        <div className="field"><label>Team</label>
          <select value={v.team} onChange={e => setV({ ...v, team: e.target.value })}>
            <option value="">Any team</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field"><label>Number of days</label>
          <input type="number" min={1} max={60} value={v.days} onChange={e => setV({ ...v, days: e.target.value })} style={{ maxWidth: 120 }} />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : path ? 'Save Changes' : 'Create'}</button>
        </div>
      </div>
    </Modal>
  );
}

// Add / edit one item of a path
function ItemModal({ data, path, item, dayNo, days, user, onClose, onSaved }) {
  const [v, setV] = useState({
    kind: item?.kind ?? 'sop', sop_id: item?.sop_id ?? '', title: item?.title ?? '', url: item?.url ?? '',
    needs_trainer: item?.needs_trainer ?? false, needs_quiz: item?.needs_quiz ?? false, day_no: item?.day_no ?? dayNo,
  });
  const [sopQuery, setSopQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = patch => { setV(x => ({ ...x, ...patch })); setError(''); };

  const q = sopQuery.trim().toLowerCase();
  const sops = data.sops
    .filter(s => s.active !== false || s.id === item?.sop_id)
    .filter(s => !q || s.title.toLowerCase().includes(q) || String(s.id) === String(v.sop_id))
    .sort((a, b) => a.title.localeCompare(b.title));

  async function save() {
    if (v.kind === 'sop' && !v.sop_id) return setError('Choose the SOP.');
    if (v.kind !== 'sop' && !v.title.trim()) return setError('Please describe the item.');
    let url = v.url.trim();
    if (v.kind === 'link') {
      if (!url) return setError('Please paste the link.');
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    }
    setSaving(true);
    const row = await saveItem(data, item, {
      path_id: path.id, kind: v.kind, day_no: Number(v.day_no),
      sop_id: v.kind === 'sop' ? Number(v.sop_id) : null,
      title: v.title.trim() || null, url: v.kind === 'link' ? url : null,
      needs_trainer: v.kind === 'sop' ? false : !!v.needs_trainer,
      ...(data.quizReady ? { needs_quiz: v.kind === 'sop' && !!v.needs_quiz } : {}),
    }, user);
    setSaving(false);
    if (!row) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title={item ? 'Edit item' : 'Add item'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="field">
          <label>Type</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {ITEM_KINDS.map(k => (
              <button key={k.value} type="button" className={v.kind === k.value ? 'btn-primary btn-sm' : 'btn-sm'}
                aria-pressed={v.kind === k.value} onClick={() => set({ kind: k.value })}>{k.icon} {k.label}</button>
            ))}
          </div>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>{kindOf(v.kind).hint}</div>
        </div>

        {v.kind === 'sop' && (
          <div className="field">
            <label>SOP *</label>
            <input type="search" value={sopQuery} placeholder="Search SOP titles" onChange={e => setSopQuery(e.target.value)} style={{ marginBottom: 6 }} />
            <select value={String(v.sop_id)} onChange={e => set({ sop_id: e.target.value })} size={Math.min(8, Math.max(3, sops.length + 1))}>
              <option value="">— Choose —</option>
              {sops.map(s => (
                <option key={s.id} value={String(s.id)}>{s.title}{s.status !== 'published' ? ' (draft)' : ''}{s.active === false ? ' (inactive)' : ''}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>{v.kind === 'sop' ? 'Label (optional — the SOP title is used if empty)' : 'What to do *'}</label>
          <input type="text" value={v.title} onChange={e => set({ title: e.target.value })}
            placeholder={v.kind === 'link' ? 'e.g. Watch “Medicare basics” (20 min)' : v.kind === 'task' ? kindOf('task').hint : ''} />
        </div>

        {v.kind === 'link' && (
          <div className="field"><label>Link *</label>
            <input type="text" value={v.url} placeholder="https://…" onChange={e => set({ url: e.target.value })} />
          </div>
        )}

        <div className="field">
          <label>Day</label>
          <select value={String(v.day_no)} onChange={e => set({ day_no: e.target.value })} style={{ maxWidth: 140 }}>
            {Array.from({ length: days }, (_, i) => i + 1).map(d => <option key={d} value={String(d)}>Day {d}</option>)}
          </select>
        </div>

        {v.kind !== 'sop' && (
          <label className="row text-sm" style={{ gap: 8, cursor: 'pointer', marginBottom: 12 }}>
            <input type="checkbox" checked={v.needs_trainer} onChange={e => set({ needs_trainer: e.target.checked })} />
            Trainer must confirm (the person can’t tick it themselves)
          </label>
        )}
        {v.kind === 'sop' && data.quizReady && (
          <label className="row text-sm" style={{ gap: 8, cursor: 'pointer', marginBottom: 12 }}>
            <input type="checkbox" checked={v.needs_quiz} onChange={e => set({ needs_quiz: e.target.checked })} />
            Must pass the quiz (done only when the SOP is acknowledged and its quiz passed)
          </label>
        )}
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient information here.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : item ? 'Save Changes' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}

// One path's days and items, with add / edit / reorder / make inactive
function PathEditor({ data, path, user, onBack, onChanged }) {
  const [itemModal, setItemModal] = useState(null);   // { item, dayNo }
  const [editPath, setEditPath] = useState(false);
  const [busy, setBusy] = useState(false);
  const items = pathItems(data, path.id);
  const inactive = data.items.filter(i => i.path_id === path.id && i.active === false);
  const days = pathDays(path, items);

  async function changeDays(delta) {
    setBusy(true);
    await savePath(path, { days: Math.max(1, days + delta) }, user);
    setBusy(false);
    onChanged();
  }
  async function setItemActive(item, active) {
    if (!active && !await confirmDialog({
      title: 'Remove this item from the path?', message: `${itemTitle(data, item)} — progress already recorded is kept.`,
      confirmText: 'Remove', tone: 'warning',
    })) return;
    setBusy(true);
    await saveItem(data, item, { path_id: item.path_id, day_no: item.day_no, active }, user);
    setBusy(false);
    onChanged();
  }
  async function move(list, index, dir) {
    setBusy(true);
    await moveItem(list, index, dir);
    setBusy(false);
    onChanged();
  }

  return (
    <div>
      <button className="btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>← Back to paths</button>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="card-title">{path.name}</div>
          {path.team && <span className="badge badge-blue">{path.team}</span>}
          {path.active === false && <span className="badge badge-gray">Inactive</span>}
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditPath(true)}>✎ Edit details</button>
        </div>
        {path.description && <div className="text-sm text-muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{path.description}</div>}
      </div>

      {Array.from({ length: days }, (_, i) => i + 1).map(dayNo => {
        const list = items.filter(i => i.day_no === dayNo);
        return (
          <div key={dayNo} className="card mb-16">
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span className="card-title">Day {dayNo}</span>
              <span className="text-sm text-muted">{list.length} item{list.length === 1 ? '' : 's'}</span>
              <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setItemModal({ item: null, dayNo })}>+ Add item</button>
            </div>
            {list.length === 0 && <div className="text-sm text-muted">Nothing planned yet.</div>}
            {list.map((item, i) => (
              <div key={item.id} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                <span>{kindOf(item.kind).icon}</span>
                <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                  {itemTitle(data, item)}
                  {item.kind === 'link' && item.url && <span className="text-sm text-muted"> · {item.url}</span>}
                  {item.needs_trainer && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Trainer confirms</span>}
                  {item.needs_quiz && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Quiz must be passed</span>}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn-sm" title="Move up" disabled={busy || i === 0} onClick={() => move(list, i, -1)}>▲</button>
                  <button className="btn-sm" title="Move down" disabled={busy || i === list.length - 1} onClick={() => move(list, i, 1)}>▼</button>
                  <button className="btn-sm" title="Edit" onClick={() => setItemModal({ item, dayNo })}>✎</button>
                  <button className="btn-sm" title="Remove from path" disabled={busy} onClick={() => setItemActive(item, false)}>⊘</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}

      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <button className="btn-sm" disabled={busy} onClick={() => changeDays(1)}>+ Add a day</button>
        {days > 1 && !items.some(i => i.day_no === days) && (
          <button className="btn-sm" disabled={busy} onClick={() => changeDays(-1)}>− Remove empty Day {days}</button>
        )}
      </div>

      {inactive.length > 0 && (
        <div className="card mb-16">
          <div className="card-title" style={{ marginBottom: 6 }}>Removed items</div>
          {inactive.map(item => (
            <div key={item.id} className="row text-sm" style={{ gap: 8, alignItems: 'center', padding: '3px 0', opacity: 0.7 }}>
              <span>{kindOf(item.kind).icon} {itemTitle(data, item)} · Day {item.day_no}</span>
              <button className="btn-sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => setItemActive(item, true)}>↺ Put back</button>
            </div>
          ))}
        </div>
      )}

      {itemModal && (
        <ItemModal data={data} path={path} item={itemModal.item} dayNo={itemModal.dayNo} days={days} user={user}
          onClose={() => setItemModal(null)} onSaved={() => { setItemModal(null); onChanged(); }} />
      )}
      {editPath && (
        <PathModal path={path} user={user} onClose={() => setEditPath(false)} onSaved={() => { setEditPath(false); onChanged(); }} />
      )}
    </div>
  );
}

/** Manage learning paths (roadmap 3.5): list, create, copy, make inactive, edit days/items, assign. */
export default function TrainingPathEditor({ data, user, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const open = data.paths.find(p => p.id === openId);
  if (open) return <PathEditor data={data} path={open} user={user} onBack={() => setOpenId(null)} onChanged={onChanged} />;

  const paths = data.paths.filter(p => showInactive || p.active !== false);
  async function copy(path) {
    if (!await confirmDialog({ title: 'Copy this path?', message: `“${path.name}” and its items are copied as a new path.`, confirmText: 'Copy' })) return;
    const row = await copyPath(data, path, user);
    if (row) { onChanged(); setOpenId(row.id); }
  }
  async function toggle(path) {
    const deactivating = path.active !== false;
    if (!await confirmDialog(deactivating
      ? { title: 'Make this path inactive?', message: `“${path.name}” can’t be assigned any more. People who already have it keep it.`, confirmText: 'Make Inactive', tone: 'warning' }
      : { title: 'Reactivate this path?', message: path.name, confirmText: 'Reactivate' })) return;
    if (await setPathActive(path, !deactivating, user)) onChanged();
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-primary btn-sm" onClick={() => setCreating(true)}>+ New path</button>
        <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>

      {paths.length === 0 && (
        <div className="card text-muted" style={{ textAlign: 'center' }}>No learning paths yet — create one, e.g. “New AR joiner – Week 1”.</div>
      )}
      {paths.map(p => {
        const items = pathItems(data, p.id);
        const assigned = data.assignments.filter(a => a.path_id === p.id && a.active !== false).length;
        return (
          <div key={p.id} className="card mb-16" style={p.active === false ? { opacity: 0.6 } : undefined}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="card-title" onClick={() => setOpenId(p.id)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textAlign: 'left' }}>
                🎓 {p.name} ›
              </button>
              {p.team && <span className="badge badge-blue">{p.team}</span>}
              {p.active === false && <span className="badge badge-gray">Inactive</span>}
              <span className="text-sm text-muted">{pathDays(p, items)} days · {items.length} items · {assigned} assigned</span>
              <span className="row" style={{ gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {p.active !== false && <button className="btn-sm" onClick={() => setAssigning(p)}>👤 Assign</button>}
                <button className="btn-sm" onClick={() => setOpenId(p.id)}>✎ Edit</button>
                <button className="btn-sm" onClick={() => copy(p)}>Copy</button>
                <button className="btn-sm" title={p.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => toggle(p)}>
                  {p.active === false ? '↺' : '⊘'}
                </button>
              </span>
            </div>
            {p.description && <div className="text-sm text-muted" style={{ marginTop: 4 }}>{p.description}</div>}
          </div>
        );
      })}

      {creating && (
        <PathModal path={null} user={user} onClose={() => setCreating(false)}
          onSaved={row => { setCreating(false); onChanged(); setOpenId(row.id); }} />
      )}
      {assigning && (
        <TrainingAssign data={data} path={assigning} user={user} onClose={() => setAssigning(null)}
          onSaved={() => { setAssigning(null); onChanged(); }} />
      )}
    </div>
  );
}
