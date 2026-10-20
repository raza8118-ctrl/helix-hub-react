import {
  APPEAL_LEVELS, BASE_FIELDS, PATIENT_FIELDS, DISAGREE_FIELD, DENIAL_TYPES, denialTypeOf,
} from '../../lib/appeals';
import { typeOf } from '../../lib/denials';
import PayerSearch from '../../components/shared/PayerSearch';

// One input for a field definition (text / date / textarea / checklist), with its placeholder shown underneath
function Field({ f, value, onChange }) {
  let input;
  if (f.type === 'textarea') {
    input = <textarea rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  } else if (f.type === 'checklist') {
    const list = value ?? [];
    input = (
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {f.options.map(o => {
          const on = list.includes(o);
          return (
            <button key={o} type="button" className={on ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={on}
              onClick={() => onChange(on ? list.filter(x => x !== o) : [...list, o])}>{on ? '✓ ' : ''}{o}</button>
          );
        })}
      </div>
    );
  } else {
    input = <input type={f.type === 'date' ? 'date' : 'text'} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  }
  return (
    <div className="field" style={{ flex: f.type === 'textarea' || f.type === 'checklist' ? '1 1 100%' : '1 1 200px', minWidth: 0 }}>
      <label>{f.label}{f.id && <span title="Identifier — stays on this computer; only its placeholder is ever used for AI"> 🔒</span>}</label>
      {input}
      <div className="text-sm text-muted" style={{ marginTop: 2 }}><code>{f.token}</code></div>
    </div>
  );
}

/**
 * The appeal form (roadmap 5.1): claim and denial, key facts for the denial type, patient identifiers, why we disagree.
 * matched = denial codes found in the "codes" box ([{ parsed, row }]).
 */
export default function AppealForm({ form, set, ctx, payer, matched, effectiveType }) {
  const facts = denialTypeOf(effectiveType).facts;
  return (
    <div>
      <div className="card mb-16">
        <div className="card-title" style={{ marginBottom: 8 }}>1. Claim and denial</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Client</label>
            <select value={form.client_id} onChange={e => set({ client_id: e.target.value })}>
              <option value="">— Choose —</option>
              {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 240px', minWidth: 0 }}>
            <label>Payer</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span>
                  <button type="button" className="btn-sm" title="Change payer" onClick={() => set({ payer_id: '' })}>✕</button></div>
              : <PayerSearch payers={ctx.payers} onSelect={p => set({ payer_id: String(p.id) })} />}
          </div>
        </div>
        <div className="field">
          <label>Denial code(s)</label>
          <input type="text" value={form.codes} onChange={e => set({ codes: e.target.value })} placeholder="e.g. CO-197 N54 — or paste the codes from the ERA line" />
          {matched.length > 0 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {matched.map((m, i) => (
                <span key={i} className={`badge ${m.row ? 'badge-blue' : 'badge-orange'}`} title={m.row?.plain_reason ?? 'Not in the Denial library'}>
                  {m.parsed.group ? `${m.parsed.group}-` : ''}{m.parsed.code}{m.row ? ` · ${typeOf(m.row.code_type).label}` : ' · not in library'}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {BASE_FIELDS.map(f => <Field key={f.key} f={f} value={form[f.key]} onChange={v => set({ [f.key]: v })} />)}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Appeal level</label>
            <select value={form.level} onChange={e => set({ level: e.target.value })}>
              {APPEAL_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Denial type {!form.typeTouched && matched.some(m => m.row) && <span className="text-muted">(from the code)</span>}</label>
            <select value={effectiveType} onChange={e => set({ denial_type: e.target.value, typeTouched: true })}>
              {DENIAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title" style={{ marginBottom: 8 }}>Key facts — {denialTypeOf(effectiveType).label}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {facts.map(f => <Field key={f.key} f={f} value={form[f.key]} onChange={v => set({ [f.key]: v })} />)}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title" style={{ marginBottom: 4 }}>2. Patient identifiers 🔒</div>
        <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
          Stay on this computer. In letters they are filled in locally; AI (later step) only ever sees the placeholders.
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {PATIENT_FIELDS.map(f => <Field key={f.key} f={f} value={form[f.key]} onChange={v => set({ [f.key]: v })} />)}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title" style={{ marginBottom: 4 }}>3. {DISAGREE_FIELD.label}</div>
        <div className="text-sm" style={{ marginBottom: 6, color: 'var(--danger)' }}>
          ⚠ Don’t type patient names, dates of birth, member IDs or claim numbers here — use the fields above.
        </div>
        <Field f={{ ...DISAGREE_FIELD, label: 'In plain words, why the denial is wrong' }} value={form.disagree} onChange={v => set({ disagree: v })} />
      </div>
    </div>
  );
}
