import { useState, useRef } from 'react';
import { APPEAL_LEVELS } from '../../lib/appeals';
import {
  TEMPLATE_TYPES, TOKEN_GROUPS, SAMPLE_VALUES, templateTypeLabel, levelLabel, fillTemplate, checkTemplate,
  saveTemplate, reviewTemplate, setTemplateActive, missingStarterTemplates, addStarterTemplates,
} from '../../lib/appealTemplates';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Add / edit one template: placeholder picker, live preview with made-up sample values, checks
function TemplateEditor({ template, copyOf, clients, user, onClose, onSaved }) {
  const src = template ?? copyOf;
  const [v, setV] = useState({
    name: template ? template.name : copyOf ? `${copyOf.name} (copy)` : '',
    denial_type: src?.denial_type ?? 'auth', level: src?.level ?? '', client_id: src?.client_id ? String(src.client_id) : '',
    body: src?.body ?? '',
  });
  const [group, setGroup] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);
  const set = patch => { setV(x => ({ ...x, ...patch })); setError(''); };
  const warnings = checkTemplate(v.body);
  const preview = fillTemplate(v.body, SAMPLE_VALUES);

  function insert(token) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? v.body.length;
    const end = el?.selectionEnd ?? v.body.length;
    set({ body: v.body.slice(0, start) + token + v.body.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  }

  async function save() {
    if (!v.name.trim()) return setError('Please give the template a name.');
    if (!v.body.trim()) return setError('The letter text is empty.');
    if (warnings.length && !await confirmDialog({
      title: 'Save with warnings?', message: warnings.join(' '), confirmText: 'Save Anyway', tone: 'warning',
    })) return;
    setSaving(true);
    const row = await saveTemplate(template, {
      name: v.name.trim(), denial_type: v.denial_type, level: v.level || null,
      client_id: v.client_id ? Number(v.client_id) : null, body: v.body,
    }, user);
    setSaving(false);
    if (!row) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title={template ? `Edit template — ${template.name}` : 'New letter template'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm" style={{ marginTop: 0, padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)' }}>
          🔒 Placeholders only — never type a real patient, date or claim number into a template.
          A line starting with <b>?</b> is left out of the letter when any placeholder in it is empty.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 240px' }}><label>Name *</label>
            <input type="text" value={v.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Authorization denial appeal" />
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}><label>Denial type</label>
            <select value={v.denial_type} onChange={e => set({ denial_type: e.target.value })}>
              {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}><label>Appeal level</label>
            <select value={v.level} onChange={e => set({ level: e.target.value })}>
              <option value="">Any level</option>
              {APPEAL_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}><label>Client</label>
            <select value={v.client_id} onChange={e => set({ client_id: e.target.value })}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name} only</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Insert a placeholder</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={group} onChange={e => setGroup(Number(e.target.value))} style={{ maxWidth: 260 }}>
              {TOKEN_GROUPS.map((g, i) => <option key={g.label} value={i}>{g.label}</option>)}
            </select>
            {TOKEN_GROUPS[group].tokens.map(t => (
              <button key={t.token} type="button" className="btn-sm" title={t.label} onClick={() => insert(t.token)}>
                {t.label}{t.id ? ' 🔒' : ''}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Letter text *</label>
            <textarea ref={bodyRef} rows={18} value={v.body} onChange={e => set({ body: e.target.value })}
              style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <div>
            <div className="text-sm bold" style={{ marginBottom: 4 }}>Preview with made-up sample values</div>
            <div style={{
              whiteSpace: 'pre-wrap', fontFamily: "'Times New Roman', serif", fontSize: 13, lineHeight: 1.45,
              border: '1px solid var(--border)', borderRadius: 6, padding: 10, maxHeight: 380, overflowY: 'auto',
            }}>
              {preview.text || <span className="text-muted">Nothing yet.</span>}
            </div>
            {preview.missing.length > 0 && (
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>No sample value for: {preview.missing.join(', ')}</div>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <ul className="text-sm" style={{ color: 'var(--warning)', paddingLeft: 18 }}>
            {warnings.map(w => <li key={w}>⚠ {w}</li>)}
          </ul>
        )}
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : template ? 'Save Changes' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** 📚 Templates (roadmap 5.2): the company's appeal letter templates, for holders of “Manage appeal letter templates”. */
export default function AppealTemplates({ templates, clients, user, onChanged }) {
  const [editor, setEditor] = useState(null);   // { template?, copyOf? }
  const [showInactive, setShowInactive] = useState(false);
  const missing = missingStarterTemplates(templates);
  const shown = templates.filter(t => showInactive || t.active !== false);
  const clientName = id => clients.find(c => c.id === id)?.name ?? `Client #${id}`;

  async function addStarters() {
    if (!await confirmDialog({
      title: `Add ${missing.length} starter letters?`, message: missing.map(s => s.name).join(', '), confirmText: 'Add',
    })) return;
    if (await addStarterTemplates(missing, user)) onChanged();
  }
  async function review(t) {
    if (await confirmDialog({ title: 'Mark this template as reviewed?', message: 'Only after reading it through.', confirmText: 'Mark Reviewed' })
      && await reviewTemplate(t, user)) onChanged();
  }
  async function toggle(t) {
    const off = t.active !== false;
    if (!await confirmDialog(off
      ? { title: 'Make this template inactive?', message: t.name, confirmText: 'Make Inactive', tone: 'warning' }
      : { title: 'Reactivate this template?', message: t.name, confirmText: 'Reactivate' })) return;
    if (await setTemplateActive(t, !off, user)) onChanged();
  }

  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-primary btn-sm" onClick={() => setEditor({})}>+ New template</button>
        {missing.length > 0 && <button className="btn-sm" onClick={addStarters}>Add starter templates ({missing.length})</button>}
        <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      {shown.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>No templates yet.</div>}
      {TEMPLATE_TYPES.map(type => {
        const list = shown.filter(t => t.denial_type === type.value);
        if (!list.length) return null;
        return (
          <div key={type.value} className="card mb-16">
            <div className="card-title" style={{ marginBottom: 6 }}>{type.label}</div>
            {list.map(t => (
              <div key={t.id} className="row" style={{
                gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)', opacity: t.active === false ? 0.6 : 1,
              }}>
                <span className="bold">{t.name}</span>
                <span className="badge badge-gray">{levelLabel(t.level)}</span>
                {t.client_id != null && <span className="badge badge-blue">{clientName(t.client_id)} only</span>}
                {t.source === 'starter' && !t.reviewed_at && <span className="badge badge-yellow">Starter – please review</span>}
                {t.reviewed_at && <span className="text-sm text-muted">reviewed {fmtDate(t.reviewed_at)}</span>}
                {t.active === false && <span className="badge badge-gray">Inactive</span>}
                <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  {!t.reviewed_at && t.active !== false && <button className="btn-sm" onClick={() => review(t)}>✓ Reviewed</button>}
                  {t.active !== false && <button className="btn-sm" title="Edit" onClick={() => setEditor({ template: t })}>✎</button>}
                  <button className="btn-sm" title="Copy" onClick={() => setEditor({ copyOf: t })}>Copy</button>
                  <button className="btn-sm" title={t.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => toggle(t)}>{t.active === false ? '↺' : '⊘'}</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
      <div className="text-sm text-muted">“{templateTypeLabel('any')}” templates are used when no template exists for the appeal’s denial type.</div>

      {editor && (
        <TemplateEditor template={editor.template} copyOf={editor.copyOf} clients={clients} user={user}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />
      )}
    </div>
  );
}
