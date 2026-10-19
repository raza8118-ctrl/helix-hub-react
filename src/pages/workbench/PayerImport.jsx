import { useState } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { SHEETS, downloadTemplate, readWorkbook, planImport } from '../../lib/payerImport';
import { DEPARTMENTS, LIMIT_TYPES, labelOf } from '../../lib/payerOptions';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const CHUNK = 200;
const n = s => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
// NOT NULL columns that default to false / empty
const BOOL_KEYS = ['is_delegated', 'enrollment_required', 'pinned'];

const show = v => (v == null || v === '' ? '—' : Array.isArray(v) ? (v.join(', ') || '—') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const titleOf = (sheetKey, d, existing) => {
  switch (sheetKey) {
    case 'payers':   return d.name;
    case 'plans':    return d.plan_name;
    case 'ids':      return `Payer ID ${d.electronic_payer_id}${d.clearinghouse ? ` (${d.clearinghouse})` : ''}`;
    case 'contacts': return `${labelOf(DEPARTMENTS, d.department)} contact`;
    case 'limits':   return `${labelOf(LIMIT_TYPES, d.limit_type)}${d.level ? ` level ${d.level}` : ''}`;
    case 'notes':    return `Note: ${(d.note ?? existing?.note ?? '').slice(0, 50)}`;
    default:         return '';
  }
};

// Blank cells in the file → null for new entries (false / [] for required columns)
function forInsert(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === undefined ? (BOOL_KEYS.includes(k) ? false : k === 'aliases' ? [] : null) : v;
  }
  return out;
}
// Blank cells in the file leave the existing value unchanged
const definedOnly = data => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

async function insertChunks(table, rows) {
  const saved = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await S.set(table, rows.slice(i, i + CHUNK));
    if (!res) throw new Error(table);
    saved.push(...res);
  }
  return saved;
}

/**
 * Bulk-load the Payer Directory from the Excel template (roadmap 1.7).
 * Preview first; nothing is saved until confirmed. Entries that already exist are
 * skipped, or — if the user chooses to see them — kept or replaced one by one.
 */
export default function PayerImport({ user, onClose, onImported }) {
  const [step, setStep]         = useState('choose');   // choose | preview | done
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [plan, setPlan]         = useState(null);
  const [matchMode, setMatchMode] = useState('skip');   // skip | review
  const [choices, setChoices]   = useState({});         // 'sheet:row' → 'keep' | 'replace'
  const [markVerified, setMarkVerified] = useState(false);
  const [result, setResult]     = useState(null);

  async function pickFile(file) {
    if (!file) return;
    setError(''); setBusy(true);
    try {
      const [payers, plans, ids, contacts, limits, notes, clients] = await Promise.all(
        ['payers', 'payer_plans', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_notes', 'clients'].map(t => S.get(t)));
      if (payers == null || plans == null) {
        setError('The Payer Directory tables aren’t set up yet. An admin needs to run the database updates first.');
        return;
      }
      const parsed = await readWorkbook(file);
      if (!Object.keys(parsed).length) {
        setError('No template tabs were found. Use “Download template” and keep the tab names (Payers, Plans, Payer IDs, Contacts, Limits, Notes).');
        return;
      }
      setPlan(planImport(parsed, { payers, plans, ids, contacts, limits, notes, clients }));
      setChoices({});
      setStep('preview');
    } catch {
      setError('That file couldn’t be read. Please upload the .xlsx template.');
    } finally {
      setBusy(false);
    }
  }

  const keyOf = (sheetKey, m) => `${sheetKey}:${m.rowNum}`;
  const isReplace = (sheetKey, m) => matchMode === 'review' && choices[keyOf(sheetKey, m)] === 'replace';
  const totals = plan && SHEETS.reduce((t, s) => {
    const p = plan[s.key];
    t.add += p.newRows.length;
    t.matches += p.matches.length;
    t.replace += p.matches.filter(m => isReplace(s.key, m)).length;
    t.errors += p.errors.length;
    return t;
  }, { add: 0, matches: 0, replace: 0, errors: 0 });

  function setAll(choice) {
    const next = {};
    for (const s of SHEETS) for (const m of plan[s.key].matches) next[keyOf(s.key, m)] = choice;
    setChoices(next);
  }

  async function runImport() {
    if (!await confirmDialog({
      title: 'Import into the Payer Directory?',
      message: `${totals.add} new entr${totals.add === 1 ? 'y' : 'ies'} will be added`
        + (totals.replace ? ` and ${totals.replace} existing entr${totals.replace === 1 ? 'y' : 'ies'} replaced` : '')
        + `.\n${totals.matches - totals.replace} existing entr${totals.matches - totals.replace === 1 ? 'y stays' : 'ies stay'} unchanged`
        + (totals.errors ? `, and ${totals.errors} row${totals.errors === 1 ? '' : 's'} with problems will be skipped` : '') + '.',
      confirmText: 'Import',
    })) return;

    setBusy(true); setError('');
    const now = new Date().toISOString();
    const stamps = { updated_by: user.emp_id, updated_at: now };
    const verify = markVerified ? { verified_at: now, verified_by: user.emp_id } : {};
    const counts = Object.fromEntries(SHEETS.map(s => [s.key, { added: 0, replaced: 0, unchanged: 0, problems: plan[s.key].errors.length }]));
    let failedAt = null;

    try {
      // 1. Payers
      const newPayerId = new Map();
      const pp = plan.payers;
      const savedPayers = await insertChunks('payers', pp.newRows.map(r => ({
        ...forInsert(r.data), active: true, created_by: user.emp_id, ...stamps,
      })));
      savedPayers.forEach(p => newPayerId.set(n(p.name), p.id));
      counts.payers.added = savedPayers.length;
      for (const m of pp.matches) {
        if (!isReplace('payers', m)) { counts.payers.unchanged++; continue; }
        const fields = definedOnly(m.data);
        delete fields.name;   // the name is what matched — keep the existing spelling
        if (await S.update('payers', { ...fields, ...stamps }, { id: m.existing.id })) counts.payers.replaced++;
      }
      const payerIdOf = ref => ref.id ?? newPayerId.get(ref.newKey);

      // 2. Plans (other tabs may point at new ones)
      const newPlanId = new Map();
      const pl = plan.plans;
      const savedPlans = await insertChunks('payer_plans', pl.newRows.map(r => ({
        ...forInsert(r.data), payer_id: payerIdOf(r.payerRef), active: true, created_by: user.emp_id, ...stamps, ...verify,
      })));
      savedPlans.forEach(p => newPlanId.set(`${p.payer_id}|${n(p.plan_name)}`, p.id));
      counts.plans.added = savedPlans.length;
      for (const m of pl.matches) {
        if (!isReplace('plans', m)) { counts.plans.unchanged++; continue; }
        if (await S.update('payer_plans', { ...definedOnly(m.data), ...stamps, ...verify }, { id: m.existing.id })) counts.plans.replaced++;
      }
      const planIdOf = (ref, payerId) => (ref == null ? null : ref.id ?? newPlanId.get(`${payerId}|${n(ref.planName)}`) ?? null);

      // 3. Payer IDs, contacts, limits, notes
      for (const s of SHEETS.slice(2)) {
        const p = plan[s.key];
        failedAt = s.label;
        const saved = await insertChunks(s.table, p.newRows.map(r => {
          const payerId = payerIdOf(r.payerRef);
          return {
            ...forInsert(r.data), payer_id: payerId, plan_id: planIdOf(r.planRef, payerId),
            ...(s.key === 'limits' ? { client_id: r.clientId } : {}),
            active: true, created_by: user.emp_id, ...stamps, ...verify,
          };
        }));
        counts[s.key].added = saved.length;
        for (const m of p.matches) {
          if (!isReplace(s.key, m)) { counts[s.key].unchanged++; continue; }
          if (await S.update(s.table, { ...definedOnly(m.data), ...stamps, ...verify }, { id: m.existing.id })) counts[s.key].replaced++;
        }
      }
      failedAt = null;
    } catch (err) {
      failedAt = failedAt ?? SHEETS.find(s => s.table === err.message)?.label ?? 'an unknown tab';
    }

    logAudit({
      actor: user, action: 'import_payer_data', entityType: 'payer_import',
      details: { ...Object.fromEntries(SHEETS.map(s => [s.key, counts[s.key]])), ...(failedAt ? { stopped_at: failedAt } : {}) },
    });
    setResult({ counts, failedAt });
    setBusy(false);
    setStep('done');
    onImported?.();
  }

  return (
    <Modal title="Import payers from Excel" onClose={busy ? () => {} : onClose} wide>
      {step === 'choose' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="text-sm">
            1. Download the template and fill in the tabs you need (Payers, Plans, Payer IDs, Contacts, Limits, Notes).<br />
            2. Upload it here. You’ll see a preview — nothing is saved until you confirm.
          </p>
          <div className="text-sm" style={{ color: 'var(--warning)' }}>
            ⚠ Payer information only — never put patient names, member IDs or claim details in the file.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-sm" onClick={downloadTemplate}>⬇ Download template</button>
            <label className="btn-primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Reading…' : '⬆ Choose filled-in file'}
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; pickFile(f); }} />
            </label>
          </div>
          {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>
      )}

      {step === 'preview' && plan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Tab</th><th className="right">New</th><th className="right">Already exist</th><th className="right">Problems</th></tr>
              </thead>
              <tbody>
                {SHEETS.map(s => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className="right">{plan[s.key].newRows.length}</td>
                    <td className="right">{plan[s.key].matches.length}</td>
                    <td className="right" style={{ color: plan[s.key].errors.length ? 'var(--danger)' : undefined }}>{plan[s.key].errors.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totals.errors > 0 && (
            <details>
              <summary className="text-sm" style={{ cursor: 'pointer', color: 'var(--danger)' }}>
                {totals.errors} row{totals.errors === 1 ? '' : 's'} with problems will be skipped — show details
              </summary>
              <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
                {SHEETS.flatMap(s => plan[s.key].errors.map(e => (
                  <div key={`${s.key}:${e.rowNum}`} className="text-sm">{s.label} tab, row {e.rowNum}: {e.message}</div>
                )))}
              </div>
            </details>
          )}

          {totals.matches > 0 && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{totals.matches} entr{totals.matches === 1 ? 'y is' : 'ies are'} already in Helix Hub. What should happen to them?</label>
              <label className="row text-sm" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="matchMode" checked={matchMode === 'skip'} onChange={() => setMatchMode('skip')} />
                Skip them — keep the existing entries exactly as they are
              </label>
              <label className="row text-sm" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="matchMode" checked={matchMode === 'review'} onChange={() => setMatchMode('review')} />
                Show me each existing entry next to the file’s version so I can choose
              </label>
            </div>
          )}

          {matchMode === 'review' && totals.matches > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}>
              <div className="row" style={{ gap: 8, justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="text-sm text-muted">Blank cells in the file never erase existing values. Changed values are highlighted.</span>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn-sm" onClick={() => setAll('keep')}>Keep all existing</button>
                  <button className="btn-sm" onClick={() => setAll('replace')}>Replace all</button>
                </div>
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {SHEETS.flatMap(s => plan[s.key].matches.map(m => {
                  const k = keyOf(s.key, m);
                  const fields = Object.keys(m.data).filter(f => m.data[f] !== undefined);
                  const changed = fields.filter(f => show(m.data[f]) !== show(m.existing[f]));
                  return (
                    <div key={k} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div className="text-sm">
                          <strong>{titleOf(s.key, m.data, m.existing)}</strong>
                          <span className="text-muted"> · {s.label} tab, row {m.rowNum}{s.key !== 'payers' ? ` · ${m.payerRef.name}` : ''}</span>
                          {changed.length === 0 && <span className="badge badge-green" style={{ marginLeft: 6 }}>Identical</span>}
                        </div>
                        <select value={choices[k] ?? 'keep'} onChange={e => setChoices(c => ({ ...c, [k]: e.target.value }))} style={{ maxWidth: 220 }}>
                          <option value="keep">Keep existing</option>
                          <option value="replace">Replace with file values</option>
                        </select>
                      </div>
                      {changed.length > 0 && (
                        <table style={{ marginTop: 4, fontSize: 12 }}>
                          <thead><tr><th>Field</th><th>In Helix Hub now</th><th>In the file</th></tr></thead>
                          <tbody>
                            {changed.map(f => (
                              <tr key={f}>
                                <td className="text-muted">{s.columns.find(c => c.key === f)?.header ?? f}</td>
                                <td>{show(m.existing[f])}</td>
                                <td style={{ background: 'rgba(245,158,11,0.15)', fontWeight: 600 }}>{show(m.data[f])}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                }))}
              </div>
            </div>
          )}

          <label className="row text-sm" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={markVerified} onChange={e => setMarkVerified(e.target.checked)} />
            This data was checked recently — mark imported and replaced entries as verified today
          </label>

          {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div className="form-actions">
            <button className="btn-sm" onClick={() => { setStep('choose'); setPlan(null); }} disabled={busy}>← Choose another file</button>
            <button className="btn-primary" onClick={runImport} disabled={busy || (totals.add === 0 && totals.replace === 0)}>
              {busy ? 'Importing…' : `Import ${totals.add} new${totals.replace ? ` + replace ${totals.replace}` : ''}`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.failedAt
            ? <p className="text-sm" style={{ color: 'var(--danger)' }}>
                The import stopped while saving the {result.failedAt} tab. Everything listed below was saved; fix the problem and import the rest again — existing entries will be recognised.
              </p>
            : <p className="text-sm" style={{ color: 'var(--success)' }}>✓ Import finished.</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tab</th><th className="right">Added</th><th className="right">Replaced</th><th className="right">Unchanged</th><th className="right">Skipped (problems)</th></tr></thead>
              <tbody>
                {SHEETS.map(s => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className="right">{result.counts[s.key].added}</td>
                    <td className="right">{result.counts[s.key].replaced}</td>
                    <td className="right">{result.counts[s.key].unchanged}</td>
                    <td className="right">{result.counts[s.key].problems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
