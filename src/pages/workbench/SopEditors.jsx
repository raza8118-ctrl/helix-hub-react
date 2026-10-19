import { useState } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { SOP_LEVELS } from '../../lib/sops';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const now = () => new Date().toISOString();

// Choices for the "parent" field: categories, "Category › Software" or "Software › Task"
function parentOptions(level, lib, currentId) {
  const keep = r => r.active !== false || r.id === currentId;
  const label = (list, id) => list.find(r => r.id === id)?.name ?? '?';
  if (level === 'software') return lib.categories.filter(keep).map(c => ({ value: c.id, label: c.name }));
  if (level === 'task') return lib.software.filter(keep)
    .map(sw => ({ value: sw.id, label: `${label(lib.categories, sw.category_id)} › ${sw.name}` }));
  if (level === 'sop') return lib.tasks.filter(keep)
    .map(t => ({ value: t.id, label: `${label(lib.software, t.software_id)} › ${t.name}` }));
  return [];
}

function siblingsOf(level, lib, parentId) {
  const cfg = SOP_LEVELS[level];
  const all = { category: lib.categories, software: lib.software, task: lib.tasks, sop: lib.sops }[level];
  return cfg.parentKey ? all.filter(r => r[cfg.parentKey] === parentId) : all;
}

/**
 * Add / edit pop-up for any level of the SOP Library.
 * row = existing record (edit) or null (add); parentId pre-selects the parent when adding.
 */
export function SopEditModal({ level, row, parentId, lib, users, user, onClose, onSaved }) {
  const cfg = SOP_LEVELS[level];
  const editing = row != null;
  const [values, setValues] = useState(() => Object.fromEntries(cfg.fields.map(f => [f.key,
    editing ? (row[f.key] ?? '') : f.type === 'parent' ? (parentId ?? '') : f.key === 'status' ? 'draft' : ''])));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const setV = patch => { setValues(v => ({ ...v, ...patch })); setError(''); };

  async function save() {
    const missing = cfg.fields.filter(f => f.required && (values[f.key] === '' || values[f.key] == null));
    if (missing.length) return setError(`Please fill in: ${missing.map(m => m.label).join(', ')}.`);
    const clean = {};
    for (const f of cfg.fields) {
      const v = values[f.key];
      clean[f.key] = f.type === 'parent' ? Number(v) : (typeof v === 'string' ? v.trim() : v) || null;
    }
    if (clean.portal_url && !/^https?:\/\//i.test(clean.portal_url)) clean.portal_url = `https://${clean.portal_url}`;

    const parent = cfg.parentKey ? clean[cfg.parentKey] : null;
    const name = clean[cfg.nameKey];
    const duplicate = siblingsOf(level, lib, parent).some(r =>
      r.id !== row?.id && r.active !== false && (r[cfg.nameKey] ?? '').toLowerCase() === name.toLowerCase());
    if (duplicate) return setError(`There is already an active ${cfg.one.toLowerCase()} called “${name}” here.`);

    if (!await confirmDialog({
      title: editing ? 'Save changes?' : `Add this ${cfg.one.toLowerCase()}?`,
      message: name, confirmText: editing ? 'Save Changes' : 'Add',
    })) return;

    const stamp = { updated_by: user.emp_id, updated_at: now() };
    let payload = { ...clean, ...stamp };
    if (!editing || (cfg.parentKey && parent !== row[cfg.parentKey])) {
      // New, or moved under another parent: goes to the end of its new list
      const max = Math.max(0, ...siblingsOf(level, lib, parent).map(r => r.sort_order ?? 0));
      payload.sort_order = max + 1;
    }
    setSaving(true);
    const result = editing
      ? await S.update(cfg.table, payload, { id: row.id })
      : await S.set(cfg.table, { ...payload, active: true, created_by: user.emp_id });
    setSaving(false);
    if (!result?.length) return setError('Could not save. Please try again.');
    logAudit({
      actor: user, action: `${cfg.entity}_${editing ? 'edit' : 'add'}`,
      entityType: cfg.entity, entityId: result[0].id,
      details: cfg.parentKey ? { [cfg.parentKey]: parent } : null,
    });
    onSaved();
  }

  function renderField(f) {
    const v = values[f.key];
    let input;
    if (f.type === 'textarea') {
      input = <textarea rows={3} value={v ?? ''} placeholder={f.hint} onChange={e => setV({ [f.key]: e.target.value })} />;
    } else if (f.type === 'parent' || f.type === 'select' || f.type === 'user') {
      const options = f.type === 'parent' ? parentOptions(level, lib, row?.[f.key])
                    : f.type === 'user'   ? users.map(u => ({ value: u.emp_id, label: `${u.name ?? u.emp_id} (${u.emp_id})` }))
                    : f.options;
      input = (
        <select value={v == null ? '' : String(v)} onChange={e => setV({ [f.key]: e.target.value })}>
          {f.type !== 'select' && <option value="">{f.type === 'user' ? '— No owner yet —' : '— Choose —'}</option>}
          {options.map(o => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
        </select>
      );
    } else {
      input = <input type="text" value={v ?? ''} placeholder={f.hint} onChange={e => setV({ [f.key]: e.target.value })} />;
    }
    return (
      <div key={f.key} className="field">
        <label>{f.label}{f.required ? ' *' : ''}</label>
        {input}
      </div>
    );
  }

  return (
    <Modal title={`${editing ? 'Edit' : 'Add'} ${cfg.one}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {cfg.fields.map(renderField)}
        {level === 'sop' && (
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>
            Only <b>Published</b> SOPs are shown to everyone; drafts are visible to SOP editors only.
            The full SOP page (steps, screenshots) is added in a later update.
          </p>
        )}
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient information here.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
