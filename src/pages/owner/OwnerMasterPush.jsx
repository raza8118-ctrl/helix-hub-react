import { Fragment, useState, useEffect, useCallback } from 'react';
import { masterPreview, masterPush, masterPushHistory, copyMasterFiles, codeOf, HOME_CODE } from '../../lib/owner';
import { confirmDialog } from '../../components/shared/Dialog';

/**
 * Master copy → Push to companies (PO 2026-11-09, Stage 2). Pick sections + companies → Preview (the real push run in the
 * database and cancelled) → Push (one company at a time, all or nothing per company) → history.
 * A push only adds or updates master rows; a company's own rows, client-specific rows and later company edits are kept.
 */
const SECTIONS = [
  ['payers', 'Payer Directory', 'Payers, plans, payer IDs, contacts, filing limits (not client limits), notes, auth rules, payer forms (files too)'],
  ['denials', 'Denial guides', 'CARC / RARC codes and their common + payer steps (not client steps)'],
  ['codes', 'Code lists', 'Revenue, HIPPS and ICD-10 codes'],
  ['sops', 'SOP Library', 'Categories, software, tasks, SOPs with their screenshots and videos (not client SOPs)'],
  ['targets', 'Task targets', 'Default targets per process and task'],
];
const TABLES = {
  payers: 'Payers', payer_plans: 'Plans', payer_ids: 'Payer IDs', payer_contacts: 'Contacts', payer_limits: 'Filing limits',
  payer_notes: 'Payer notes', payer_auth_rules: 'Auth rules', payer_forms: 'Payer forms', sop_categories: 'SOP categories', sop_software: 'Software',
  sop_tasks: 'Tasks', sops: 'SOPs', sop_media: 'SOP screenshots / videos', denial_codes: 'Denial codes', denial_steps: 'Denial steps', ref_codes: 'Codes', task_configs: 'Task targets',
};
const ORDER = Object.keys(TABLES);
const KINDS = [
  ['new', 'New', 'badge-green'], ['updated', 'Updated', 'badge-blue'], ['unchanged', 'Unchanged', 'badge-gray'],
  ['kept_own', 'Kept: company’s own', 'badge-yellow'], ['kept_changed', 'Kept: changed here', 'badge-yellow'],
  ['skipped_parent', 'Skipped: payer is company’s own', 'badge-gray'], ['conflict', 'Could not apply', 'badge-red'],
];
const ERR = { no_master: 'The master copy is not set up.', no_company: 'That company was not found.', bad_sections: 'Pick at least one section.', NOT_SET_UP: 'Push needs the database update (migration 48) first.' };
const total = (res, kind) => Object.values(res ?? {}).reduce((t, e) => t + (e[kind] ?? 0), 0);
const fmt = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Result({ res }) {
  const tables = ORDER.filter(t => res?.[t]);
  if (!tables.length) return <p className="text-sm text-muted" style={{ margin: 0 }}>Nothing in the master copy for these sections.</p>;
  return (
    <div className="table-wrap">
      <table className="omp-table">
        <thead><tr><th>List</th>{KINDS.map(([k, l]) => <th key={k} className="right">{l}</th>)}</tr></thead>
        <tbody>
          {tables.map(t => {
            const e = res[t];
            const named = KINDS.filter(([k]) => e.names?.[k]?.length);
            return (
              <Fragment key={t}>
                <tr className={named.length ? 'omp-has-names' : ''}>
                  <td className="bold">{TABLES[t] ?? t}</td>
                  {KINDS.map(([k, , badge]) => <td key={k} className="right">{e[k] ? <span className={`badge ${badge}`}>{e[k]}</span> : <span className="text-muted">—</span>}</td>)}
                </tr>
                {named.length > 0 && (
                  <tr className="omp-names-row">
                    <td colSpan={KINDS.length + 1}>
                      <details className="omp-names">
                        <summary>Show names</summary>
                        {named.map(([k, l]) => (
                          <div key={k}><span className="text-muted">{l}:</span> {e.names[k].join(' · ')}{(e[k] ?? 0) > e.names[k].length ? ` … and ${e[k] - e.names[k].length} more` : ''}</div>
                        ))}
                      </details>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OwnerMasterPush({ owner, rows, onClose }) {
  const [sections, setSections] = useState(['payers', 'denials', 'codes', 'sops', 'targets']);
  const [picked, setPicked] = useState(() => rows.map(codeOf));
  const [preview, setPreview] = useState(null);   // { key, byCode: { code → { ok, result | error } } }
  const [pushed, setPushed] = useState(null);     // same shape, after pushing
  const [busy, setBusy] = useState('');
  const [files, setFiles] = useState({});        // code → { total, copied, failed } | { error }
  const [history, setHistory] = useState(undefined);

  const nameOf = code => rows.find(c => codeOf(c) === code)?.name ?? code;
  const key = JSON.stringify([sections.slice().sort(), picked.slice().sort()]);

  const loadHistory = useCallback(async () => {
    const r = await masterPushHistory(owner);
    setHistory(r.error ? null : r.data);
  }, [owner]);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => alive && loadHistory());
    return () => { alive = false; };
  }, [loadHistory]);

  const toggle = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  async function runAll(fn, label) {
    const byCode = {};
    for (const code of picked) {
      setBusy(`${label} ${nameOf(code)}…`);
      const r = await fn(owner, code, sections);
      byCode[code] = r.error ? { ok: false, error: ERR[r.error] ?? r.error }
        : r.data?.ok === false ? { ok: false, error: ERR[r.data.error] ?? r.data.error } : { ok: true, result: r.data.result };
    }
    setBusy('');
    return byCode;
  }

  // Files (payer forms, SOP screenshots / videos) are copied by the app after the rows are pushed; this also retries
  async function copyFiles(codes) {
    const out = {};
    for (const code of codes) {
      setBusy(`Copying files to ${nameOf(code)}…`);
      out[code] = await copyMasterFiles(owner, code);
    }
    setBusy('');
    setFiles(f => ({ ...f, ...out }));
  }

  async function doPreview() {
    setFiles({});
    setPushed(null);
    setPreview({ key, byCode: await runAll(masterPreview, 'Previewing') });
  }

  async function doPush() {
    const n = picked.length;
    const adds = picked.reduce((t, c) => t + total(preview.byCode[c]?.result, 'new') + total(preview.byCode[c]?.result, 'updated'), 0);
    if (!await confirmDialog({
      title: `Push to ${n} compan${n === 1 ? 'y' : 'ies'}?`,
      message: `${adds} row${adds === 1 ? '' : 's'} will be added or updated, as in the preview. Nothing is deleted, and each company's own rows and later edits stay as they are. Logged in your owner log and each company's Audit Log.`,
      confirmText: 'Push',
    })) return;
    const done = await runAll(masterPush, 'Pushing to');
    setPushed(done);
    setPreview(null);
    await copyFiles(Object.keys(done).filter(code => done[code].ok));
    loadHistory();
  }

  const shown = pushed ?? (preview?.key === key ? preview.byCode : null);
  const stale = preview && preview.key !== key;

  return (
    <div className="card fg-card omp">
      <div className="card-header">
        <div className="card-title">Push to companies</div>
        <button type="button" className="btn-sm" onClick={onClose}>Close</button>
      </div>

      <div className="omp-pick">
        <fieldset>
          <legend>What to push</legend>
          {SECTIONS.map(([id, label, hint]) => (
            <label key={id} className="omp-check" title={hint}>
              <input type="checkbox" checked={sections.includes(id)} onChange={() => toggle(sections, setSections, id)} />
              <span><strong>{label}</strong><span className="text-muted text-sm"> · {hint}</span></span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Companies</legend>
          <label className="omp-check">
            <input type="checkbox" checked={picked.length === rows.length} onChange={() => setPicked(picked.length === rows.length ? [] : rows.map(codeOf))} />
            <span><strong>All companies</strong></span>
          </label>
          {rows.map(c => (
            <label key={codeOf(c)} className="omp-check">
              <input type="checkbox" checked={picked.includes(codeOf(c))} onChange={() => toggle(picked, setPicked, codeOf(c))} />
              <span>{c.name}{codeOf(c) === HOME_CODE ? <span className="text-muted text-sm"> · home</span> : ''}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' }}>
        <button type="button" className="btn-sm btn-primary" onClick={doPreview} disabled={!!busy || !sections.length || !picked.length}>Preview</button>
        <button type="button" className="btn-sm" onClick={doPush} disabled={!!busy || !preview || stale || Object.values(preview.byCode).some(r => !r.ok)}
          title={!preview ? 'Preview first' : stale ? 'The choices changed — preview again' : ''}>
          Push to {picked.length} compan{picked.length === 1 ? 'y' : 'ies'}
        </button>
        <button type="button" className="btn-sm" onClick={() => copyFiles(picked)} disabled={!!busy || !picked.length}
          title="Copies any pushed payer forms and SOP screenshots / videos these companies don't have yet">Copy missing files</button>
        <span className="text-sm text-muted" role="status">
          {busy || (Object.values(files).some(f => f.failed || f.error) ? 'Some files could not be copied — use Copy missing files to try again.' : stale ? 'The choices changed since the preview — preview again before pushing.' : pushed ? 'Pushed. Results below.' : preview ? 'Preview below — nothing has changed yet.' : 'Preview first: it shows exactly what a push will do, then changes nothing.')}
        </span>
      </div>

      {shown && picked.filter(code => shown[code]).map(code => (
        <div key={code} className="omp-co">
          <div className="omp-co-head">
            <span className="bold">{nameOf(code)}</span>
            {files[code] && (
              <span className={`text-sm ${files[code].failed || files[code].error ? 'ot-err' : 'text-muted'}`} style={{ margin: 0 }}>
                {files[code].error ? `Files: ${files[code].error}`
                  : files[code].total ? `Files: ${files[code].copied} copied${files[code].failed ? `, ${files[code].failed} could not be copied` : ''}` : 'Files: none needed'}
              </span>
            )}
            {shown[code].ok && <span className="text-sm text-muted">{pushed ? 'Pushed' : 'Would'}: {total(shown[code].result, 'new')} new · {total(shown[code].result, 'updated')} updated · {total(shown[code].result, 'kept_own') + total(shown[code].result, 'kept_changed')} kept</span>}
          </div>
          {shown[code].ok ? <Result res={shown[code].result} /> : <p className="ot-err" role="alert">{shown[code].error}</p>}
        </div>
      ))}

      <div className="omp-history">
        <div className="bold" style={{ marginBottom: 6 }}>Push history</div>
        {history === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}
        {history === null && <p className="text-sm text-muted" style={{ margin: 0 }}>History appears after the database update (migration 48).</p>}
        {history?.length === 0 && <p className="text-sm text-muted" style={{ margin: 0 }}>No pushes yet.</p>}
        {history?.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Owner</th><th>Company</th><th>Sections</th><th className="right">New</th><th className="right">Updated</th><th className="right">Kept</th></tr></thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="text-sm">{fmt(h.pushed_at)}</td>
                    <td>{h.owner}</td>
                    <td>{nameOf(h.company_code)}</td>
                    <td className="text-sm">{h.sections.map(s => SECTIONS.find(x => x[0] === s)?.[1] ?? s).join(', ')}</td>
                    <td className="right">{total(h.summary, 'new')}</td>
                    <td className="right">{total(h.summary, 'updated')}</td>
                    <td className="right">{total(h.summary, 'kept_own') + total(h.summary, 'kept_changed')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
