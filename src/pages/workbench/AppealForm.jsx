import {
  APPEAL_LEVELS, BASE_FIELDS, PATIENT_FIELDS, DISAGREE_FIELD, DENIAL_TYPES, denialTypeOf,
} from '../../lib/appeals';
import { typeOf } from '../../lib/denials';
import PayerSearch from '../../components/shared/PayerSearch';
import { Card, Button, Badge, Chip, Notice, Field as UiField } from '../../components/ui';

// One input for a field definition (text / date / textarea / checklist), with its placeholder shown underneath
function Field({ f, value, onChange }) {
  let input;
  if (f.type === 'textarea') {
    input = <textarea rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  } else if (f.type === 'checklist') {
    const list = value ?? [];
    input = (
      <div className="ui-chips">
        {f.options.map(o => {
          const on = list.includes(o);
          return (
            <Chip key={o} on={on} onClick={() => onChange(on ? list.filter(x => x !== o) : [...list, o])}>{on ? '✓ ' : ''}{o}</Chip>
          );
        })}
      </div>
    );
  } else {
    input = <input type={f.type === 'date' ? 'date' : 'text'} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  }
  return (
    <div style={{ flex: f.type === 'textarea' || f.type === 'checklist' ? '1 1 100%' : '1 1 200px', minWidth: 0 }}>
      <UiField label={<>{f.label}{f.id && <span title="Identifier — stays on this computer; only its placeholder is ever used for AI"> 🔒</span>}</>}
        hint={<code>{f.token}</code>}>
        {input}
      </UiField>
    </div>
  );
}

const fieldRow = { display: 'flex', flexWrap: 'wrap', gap: '0 var(--ui-s3)' };

/**
 * The appeal form (roadmap 5.1): claim and denial, key facts for the denial type, patient identifiers, why we disagree.
 * matched = denial codes found in the "codes" box ([{ parsed, row }]).
 */
export default function AppealForm({ form, set, ctx, payer, matched, effectiveType }) {
  const facts = denialTypeOf(effectiveType).facts;
  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      <Card title="1. Claim and denial">
        <div style={fieldRow}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <UiField label="Client">
              <select value={form.client_id} onChange={e => set({ client_id: e.target.value })}>
                <option value="">— Choose —</option>
                {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </UiField>
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <UiField label="Payer">
              {payer
                ? <div className="ui-row" style={{ gap: 4, minHeight: 36 }}><Badge tone="info">{payer.name}</Badge>
                    <Button size="xs" variant="ghost" title="Change payer" aria-label="Change payer" onClick={() => set({ payer_id: '' })}>✕</Button></div>
                : <PayerSearch payers={ctx.payers} onSelect={p => set({ payer_id: String(p.id) })} />}
            </UiField>
          </div>
        </div>
        <UiField label="Denial code(s)">
          <input type="text" value={form.codes} onChange={e => set({ codes: e.target.value })} placeholder="e.g. CO-197 N54 — or paste the codes from the ERA line" />
          {matched.length > 0 && (
            <div className="ui-row" style={{ gap: 4 }}>
              {matched.map((m, i) => (
                <Badge key={i} tone={m.row ? 'info' : 'warn'} title={m.row?.plain_reason ?? 'Not in the Denial library'}>
                  {m.parsed.group ? `${m.parsed.group}-` : ''}{m.parsed.code}{m.row ? ` · ${typeOf(m.row.code_type).label}` : ' · not in library'}
                </Badge>
              ))}
            </div>
          )}
        </UiField>
        <div style={fieldRow}>
          {BASE_FIELDS.map(f => <Field key={f.key} f={f} value={form[f.key]} onChange={v => set({ [f.key]: v })} />)}
        </div>
        <div style={fieldRow}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <UiField label="Appeal level">
              <select value={form.level} onChange={e => set({ level: e.target.value })}>
                {APPEAL_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </UiField>
          </div>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <UiField label={<>Denial type {!form.typeTouched && matched.some(m => m.row) && <span className="ui-text-muted">(from the code)</span>}</>}>
              <select value={effectiveType} onChange={e => set({ denial_type: e.target.value, typeTouched: true })}>
                {DENIAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </UiField>
          </div>
        </div>
      </Card>

      <Card title={`Key facts — ${denialTypeOf(effectiveType).label}`}>
        <div style={fieldRow}>
          {facts.map(f => <Field key={f.key} f={f} value={form[f.key]} onChange={v => set({ [f.key]: v })} />)}
        </div>
      </Card>

      <Card title="2. Patient identifiers 🔒"
        subtitle="Stay on this computer. In letters they are filled in locally; AI (later step) only ever sees the placeholders.">
        <div style={fieldRow}>
          {PATIENT_FIELDS.map(f => <Field key={f.key} f={f} value={form[f.key]} onChange={v => set({ [f.key]: v })} />)}
        </div>
      </Card>

      <Card title={`3. ${DISAGREE_FIELD.label}`}>
        <Notice tone="bad" style={{ marginBottom: 'var(--ui-s3)' }}>
          ⚠ Don’t type patient names, dates of birth, member IDs or claim numbers here — use the fields above.
        </Notice>
        <Field f={{ ...DISAGREE_FIELD, label: 'In plain words, why the denial is wrong' }} value={form.disagree} onChange={v => set({ disagree: v })} />
      </Card>
    </div>
  );
}
