import { useState, useRef } from 'react';
import { APPEAL_LEVELS } from '../../lib/appeals';
import {
  TEMPLATE_TYPES, TOKEN_GROUPS, SAMPLE_VALUES, templateTypeLabel, levelLabel, fillTemplate, checkTemplate,
  saveTemplate, reviewTemplate, setTemplateActive, missingStarterTemplates, addStarterTemplates,
} from '../../lib/appealTemplates';
import { confirmDialog } from '../../components/shared/Dialog';
import { Modal, Card, Button, Badge, Check, Field, FormActions, Notice, Toolbar, ToolbarSpacer, EmptyState } from '../../components/ui';

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
      <div>
        <Notice style={{ marginBottom: 'var(--ui-s3)' }}>
          🔒 Placeholders only — never type a real patient, date or claim number into a template.
          A line starting with <b>?</b> is left out of the letter when any placeholder in it is empty.
        </Notice>
        <div className="ui-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field label="Name" required>
            <input type="text" value={v.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Authorization denial appeal" />
          </Field>
          <Field label="Denial type">
            <select value={v.denial_type} onChange={e => set({ denial_type: e.target.value })}>
              {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Appeal level">
            <select value={v.level} onChange={e => set({ level: e.target.value })}>
              <option value="">Any level</option>
              {APPEAL_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
          <Field label="Client">
            <select value={v.client_id} onChange={e => set({ client_id: e.target.value })}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name} only</option>)}
            </select>
          </Field>
        </div>

        <Field label="Insert a placeholder">
          <div className="ui-row" style={{ gap: 6 }}>
            <select className="ui-input" value={group} onChange={e => setGroup(Number(e.target.value))} style={{ maxWidth: 260, width: 'auto' }} aria-label="Placeholder group">
              {TOKEN_GROUPS.map((g, i) => <option key={g.label} value={i}>{g.label}</option>)}
            </select>
            {TOKEN_GROUPS[group].tokens.map(t => (
              <Button key={t.token} size="xs" title={t.label} onClick={() => insert(t.token)}>
                {t.label}{t.id ? ' 🔒' : ''}
              </Button>
            ))}
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--ui-s3)' }}>
          <Field label="Letter text" required style={{ marginBottom: 0 }}>
            <textarea ref={bodyRef} rows={18} value={v.body} onChange={e => set({ body: e.target.value })}
              style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Field>
          <div>
            <div className="ui-label" style={{ marginBottom: 5 }}>Preview with made-up sample values</div>
            <div className="ui-paper small" style={{ maxHeight: 380 }}>
              {preview.text || <span className="ui-text-muted">Nothing yet.</span>}
            </div>
            {preview.missing.length > 0 && (
              <div className="ui-muted" style={{ marginTop: 4 }}>No sample value for: {preview.missing.join(', ')}</div>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <Notice tone="warn" style={{ marginTop: 'var(--ui-s3)' }}>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {warnings.map(w => <li key={w}>⚠ {w}</li>)}
            </ul>
          </Notice>
        )}
        {error && <Notice tone="bad" style={{ marginTop: 'var(--ui-s3)' }}>{error}</Notice>}
        <FormActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : template ? 'Save Changes' : 'Add'}</Button>
        </FormActions>
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
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      <Toolbar>
        <Button size="sm" variant="primary" onClick={() => setEditor({})}>+ New template</Button>
        {missing.length > 0 && <Button size="sm" onClick={addStarters}>Add starter templates ({missing.length})</Button>}
        <ToolbarSpacer />
        <Check inline checked={showInactive} onChange={e => setShowInactive(e.target.checked)}>Show inactive</Check>
      </Toolbar>
      {shown.length === 0 && <Card><EmptyState icon="📚" title="No templates yet." /></Card>}
      {TEMPLATE_TYPES.map(type => {
        const list = shown.filter(t => t.denial_type === type.value);
        if (!list.length) return null;
        return (
          <Card key={type.value} title={type.label}>
            {list.map(t => (
              <div key={t.id} className={`ui-listrow${t.active === false ? ' dim' : ''}`}>
                <span className="bold">{t.name}</span>
                <Badge>{levelLabel(t.level)}</Badge>
                {t.client_id != null && <Badge tone="info">{clientName(t.client_id)} only</Badge>}
                {t.source === 'starter' && !t.reviewed_at && <Badge tone="warn">Starter – please review</Badge>}
                {t.reviewed_at && <span className="ui-small ui-text-good">reviewed {fmtDate(t.reviewed_at)}</span>}
                {t.active === false && <Badge>Inactive</Badge>}
                <span className="ui-row" style={{ gap: 4, marginLeft: 'auto' }}>
                  {!t.reviewed_at && t.active !== false && <Button size="xs" variant="success" onClick={() => review(t)}>✓ Reviewed</Button>}
                  {t.active !== false && <Button size="xs" title="Edit" aria-label="Edit" onClick={() => setEditor({ template: t })}>✎</Button>}
                  <Button size="xs" title="Copy" onClick={() => setEditor({ copyOf: t })}>Copy</Button>
                  <Button size="xs" title={t.active === false ? 'Reactivate' : 'Make inactive'} aria-label={t.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => toggle(t)}>{t.active === false ? '↺' : '⊘'}</Button>
                </span>
              </div>
            ))}
          </Card>
        );
      })}
      <div className="ui-muted">“{templateTypeLabel('any')}” templates are used when no template exists for the appeal’s denial type.</div>

      {editor && (
        <TemplateEditor template={editor.template} copyOf={editor.copyOf} clients={clients} user={user}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />
      )}
    </div>
  );
}
