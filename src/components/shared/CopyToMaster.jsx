import { useState } from 'react';
import { getActiveCompany } from '../../lib/supabase';
import { getOwnerSession } from '../../lib/company';
import { masterCopyPreview, masterCopy } from '../../lib/owner';
import Modal from './Modal';

/**
 * "Copy to Master" (PO 2026-11-10): the Helix Hub owner promotes a home-company payer / denial code / SOP into the
 * shared Master Library. Preview first; if the master already has it the owner chooses Update or Skip. The home
 * company's own rows are never moved or deleted. Shown only to the owner (not "sign in as") inside the home company.
 */
const KIND = { payer: 'payer', code: 'denial code', sop: 'SOP' };
const DETAIL = {
  payer_plans: 'plans', payer_ids: 'payer IDs', payer_contacts: 'contacts', payer_limits: 'filing limits', payer_notes: 'notes',
  payer_auth_rules: 'auth rules', payer_forms: 'forms', denial_steps: 'common steps', sop_media: 'screenshots / videos',
  'new category': 'new category', 'new software': 'new software', 'new task': 'new task',
};
const ERR = { not_found: 'That item no longer exists.', client_sop: 'Client SOPs stay with the company — only common SOPs can be copied.', no_master: 'The Master Library is not set up.' };

const canCopyToMaster = user => !!user?.isOwner && !user?.viewingAs && !getActiveCompany()?.prefix;

export default function CopyToMaster({ kind, id, user, size = 'btn-sm' }) {
  const [state, setState] = useState(null);   // null = closed · { preview } · { result } · { error }
  const [busy, setBusy] = useState(false);
  if (!canCopyToMaster(user) || id == null) return null;
  const owner = getOwnerSession();

  async function open() {
    setState({ loading: true });
    const r = await masterCopyPreview(owner, kind, id);
    if (r.error) setState({ error: r.error === 'NOT_SET_UP' ? 'Copy to Master needs the database update (migration 52) first.' : r.error });
    else if (r.data?.ok === false) setState({ error: ERR[r.data.error] ?? r.data.error });
    else setState({ preview: r.data });
  }

  async function run(mode) {
    setBusy(true);
    const r = await masterCopy(owner, kind, id, mode);
    setBusy(false);
    if (r.error) { setState({ error: r.error }); return; }
    if (r.data?.ok === false) { setState({ error: ERR[r.data.error] ?? r.data.error }); return; }
    setState({ result: r.data, files: r.files });
  }

  const details = d => Object.entries(d ?? {}).filter(([k]) => k !== 'version')
    .map(([k, n]) => (typeof n === 'number' && !k.startsWith('new ') ? `${n} ${DETAIL[k] ?? k}` : DETAIL[k] ?? k)).join(' · ');

  const p = state?.preview;
  return (
    <>
      <button type="button" className={size} onClick={open} title="Owner only: add this to the shared Master Library (nothing here is moved or deleted)">⤴ Copy to Master</button>
      {state && (
        <Modal title={`Copy ${KIND[kind]} to the Master Library`} onClose={() => setState(null)}>
          {state.loading && <div className="loading-row"><div className="spinner" /> Checking the Master Library…</div>}
          {state.error && <p className="ot-err">{state.error}</p>}
          {p && (
            <>
              <p style={{ marginTop: 0 }}><strong>{p.label}</strong></p>
              {p.exists
                ? <p className="text-sm">The Master Library already has this {KIND[kind]}. <strong>Update the master</strong> replaces the master’s wording with this one (its matching details are updated, missing ones added — nothing is removed), or <strong>Skip</strong> to leave the master as it is.</p>
                : <p className="text-sm">Not in the Master Library yet — it will be added, read-only for every company.</p>}
              {details(p.detail) && <p className="text-sm text-muted">With: {details(p.detail)}{p.detail?.version ? ` · published version ${p.detail.version}` : ''}.</p>}
              <p className="text-sm text-muted">Nothing in this company is moved or deleted. Logged in your owner log and the Master Library history.</p>
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="btn-sm" onClick={() => setState(null)}>{p.exists ? 'Skip' : 'Cancel'}</button>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => run(p.exists ? 'update' : 'add')}>
                  {busy ? 'Copying…' : p.exists ? 'Update the master' : 'Add to Master'}
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
              <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn-primary" onClick={() => setState(null)}>Done</button></div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
