import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import { masterCopyFromPreview, masterCopyFrom, codeOf } from '../../lib/owner';
import { logCompanyData } from '../../lib/companyData';

/**
 * Owner → Company Data → "⤴ Save to Master" (PO 2026-11-10, Stage 3; migration 54). Promotes one payer / denial code /
 * SOP / code-list row of any company into the shared Master Library. Preview first; if the master already has it the
 * owner chooses Update the master or Skip. The company's rows are never moved or deleted. Logged in the owner log, the
 * master history and the company's Audit Log.
 */
const KIND = { payer: 'payer', code: 'denial code', sop: 'SOP', ref_code: 'code' };
const DETAIL = {
  payer_plans: 'plans', payer_ids: 'payer IDs', payer_contacts: 'contacts', payer_limits: 'filing limits', payer_notes: 'notes',
  payer_auth_rules: 'auth rules', payer_forms: 'forms', denial_steps: 'common steps', sop_media: 'screenshots / videos',
  'new category': 'new category', 'new software': 'new software', 'new task': 'new task',
};
const ERR = {
  not_found: 'That item no longer exists.', client_sop: 'Client SOPs stay with the company — only common SOPs can be saved to the master.',
  no_master: 'The Master Library is not set up.', no_company: 'That company was not found.', is_master: 'This is the Master Library itself.',
  NOT_SET_UP: 'Save to Master needs the database update (migration 54) first.',
};
const details = d => Object.entries(d ?? {}).filter(([k]) => k !== 'version')
  .map(([k, n]) => (typeof n === 'number' && !k.startsWith('new ') ? `${n} ${DETAIL[k] ?? k}` : DETAIL[k] ?? k)).join(' · ');

export default function SaveToMaster({ owner, company, mod, row, onClose }) {
  const [state, setState] = useState({ loading: true });   // { loading } · { preview } · { result, files } · { error }
  const [busy, setBusy] = useState(false);
  const kind = mod.master;
  const code = codeOf(company);

  useEffect(() => {
    let alive = true;
    masterCopyFromPreview(owner, code, kind, row.id).then(r => {
      if (!alive) return;
      if (r.error) setState({ error: ERR[r.error] ?? r.error });
      else if (r.data?.ok === false) setState({ error: ERR[r.data.error] ?? r.data.error });
      else setState({ preview: r.data });
    });
    return () => { alive = false; };
  }, [owner, code, kind, row.id]);

  async function run(mode) {
    setBusy(true);
    const r = await masterCopyFrom(owner, code, kind, row.id, mode);
    setBusy(false);
    if (r.error || r.data?.ok === false) { setState({ error: ERR[r.error ?? r.data.error] ?? r.error ?? r.data.error }); return; }
    logCompanyData(owner, company, 'company_data_save_to_master', {
      module: mod.label, item: r.data.label, id: row.id, mode, updated_master: !!r.data.exists, files: r.files.total,
    });
    setState({ result: r.data, files: r.files });
  }

  const p = state.preview;
  return (
    <Modal title={`Save ${KIND[kind]} to the Master Library`} onClose={busy ? () => {} : onClose}>
      {state.loading && <div className="loading-row"><div className="spinner" /> Checking the Master Library…</div>}
      {state.error && <p className="ot-err">{state.error}</p>}
      {p && (
        <>
          <p style={{ marginTop: 0 }}><strong>{p.label}</strong> <span className="text-sm text-muted">from {company.name}</span></p>
          {p.exists
            ? <p className="text-sm">The Master Library already has this {KIND[kind]}. <strong>Update the master</strong> replaces the master’s wording with {company.name}’s (matching details are updated, missing ones added — nothing is removed), or <strong>Skip</strong> to leave the master as it is.</p>
            : <p className="text-sm">Not in the Master Library yet — it will be added, read-only for every company.</p>}
          {details(p.detail) && <p className="text-sm text-muted">With: {details(p.detail)}{p.detail?.version ? ` · published version ${p.detail.version}` : ''}.</p>}
          <p className="text-sm text-muted">Nothing in {company.name} is moved or deleted. Logged in your owner log, the Master Library history and {company.name}’s Audit Log.</p>
          <div className="si-actions">
            <button type="button" className="btn-sm" onClick={onClose} disabled={busy}>{p.exists ? 'Skip' : 'Cancel'}</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => run(p.exists ? 'update' : 'add')}>
              {busy ? 'Saving…' : p.exists ? 'Update the master' : 'Add to Master'}
            </button>
          </div>
        </>
      )}
      {state.result && (
        <>
          <p style={{ marginTop: 0 }}>✓ <strong>{state.result.label}</strong> {state.result.exists ? 'updated in' : 'added to'} the Master Library.</p>
          {details(state.result.detail) && <p className="text-sm text-muted">{details(state.result.detail)}</p>}
          {state.files?.total > 0 && (
            <p className={`text-sm ${state.files.failed ? 'ot-err' : 'text-muted'}`}>
              Files: {state.files.copied} copied{state.files.failed ? `, ${state.files.failed} could not be copied — try again later` : ''}.
            </p>
          )}
          <div className="si-actions"><button type="button" className="btn-primary" onClick={onClose}>Done</button></div>
        </>
      )}
      {state.error && <div className="si-actions"><button type="button" className="btn-sm" onClick={onClose}>Close</button></div>}
    </Modal>
  );
}
