import { useState, useEffect, useCallback } from 'react';
import { masterStatus, masterSeed } from '../../lib/owner';
import { confirmDialog, alertDialog } from '../../components/shared/Dialog';
import NavIcon from '../../components/ui/NavIcon';
import OwnerMasterPush from './OwnerMasterPush';

/**
 * Master copy card (PO 2026-11-09, Stage 1): the hidden workspace the owner edits once and later pushes to companies.
 * Editing uses the normal pages (Payer Directory, Denial Navigator, SOP Library, Code Lookup, Settings → task targets).
 */
const LISTS = [
  ['payers', 'Payers'], ['payer_ids', 'Payer IDs'], ['payer_contacts', 'Contacts'], ['payer_limits', 'Filing limits'],
  ['payer_notes', 'Payer notes'], ['denial_codes', 'Denial codes'], ['denial_steps', 'Denial steps'], ['ref_codes', 'Code lists'],
  ['sops', 'SOPs'], ['task_configs', 'Task targets'],
];

export default function OwnerMasterCopy({ owner, rows, home, onOpen }) {
  const [st, setSt] = useState(undefined);   // undefined = loading · null = migration 47 not run · { exists, counts… }
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);

  const load = useCallback(async () => {
    const r = await masterStatus(owner);
    setSt(r.error ? null : r.data);
  }, [owner]);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => alive && load());
    return () => { alive = false; };
  }, [load]);

  const counts = st?.counts ?? {};
  const empty = Object.values(counts).every(n => !n);
  const homeName = home?.name ?? 'the home company';

  async function seed() {
    if (!await confirmDialog({
      title: `Start the master copy from ${homeName}'s lists?`,
      message: `Copies ${homeName}'s Payer Directory, denial codes and steps, code lists, SOP Library and task targets into the master copy, once. ${homeName}'s own rows are not changed. Client-specific rows and attached files are not copied.`,
      confirmText: 'Copy into master',
    })) return;
    setBusy(true);
    const r = await masterSeed(owner);
    setBusy(false);
    if (r.error || r.data?.ok === false) {
      await alertDialog({ title: 'Could not copy', message: r.data?.error === 'not_empty' ? 'The master copy already has rows — this only works once, into an empty master.' : (r.error ?? 'Please try again.'), tone: 'warning' });
      return;
    }
    const c = r.data.copied ?? {};
    await alertDialog({
      title: 'Master copy started',
      message: LISTS.map(([k, l]) => `${l}: ${c[k] ?? 0}`).join('\n') + `\nSOP categories: ${c.sop_categories ?? 0} · software: ${c.sop_software ?? 0}`,
      tone: 'success',
    });
    load();
  }

  return (
    <div className="card fg-card omd-master">
      <div className="card-header">
        <div className="card-title"><NavIcon icon="database" size={16} /> Master copy</div>
        <span className="text-sm text-muted">Edit once here, then push to companies</span>
      </div>
      {st === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}
      {st === null && <p className="text-sm" style={{ margin: 0 }}>The master copy needs the database update (migration 47) first.</p>}
      {st && !st.exists && <p className="text-sm" style={{ margin: 0 }}>The master copy isn't set up yet — run migration 47 again.</p>}
      {st?.exists && (
        <>
          <div className="omd-master-grid">
            {LISTS.map(([k, l]) => (
              <div key={k} className="oc-co-stat"><div className="oc-co-stat-l">{l}</div><div className="bold">{counts[k] ?? 0}</div></div>
            ))}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn-sm btn-primary" onClick={() => onOpen({ name: st.name, code: st.code, prefix: st.prefix, is_master: true }, { startTab: 'wb_payers' })}>
              Edit master copy
            </button>
            {empty && <button type="button" className="btn-sm" onClick={seed} disabled={busy}>{busy ? 'Copying…' : `Start from ${homeName}'s lists`}</button>}
            <button type="button" className="btn-sm" onClick={() => setPushing(p => !p)} disabled={empty} aria-expanded={pushing}
              title={empty ? 'The master copy is empty' : 'Pick sections and companies, preview, then push'}>Push to companies…</button>
            <span className="text-sm text-muted">Opens the master with the normal pages: Payer Directory, Denial Navigator, SOP Library, Code Lookup, Settings → task targets.</span>
          </div>
        </>
      )}
      {pushing && st?.exists && !empty && <OwnerMasterPush owner={owner} rows={rows} onClose={() => { setPushing(false); load(); }} />}
    </div>
  );
}
