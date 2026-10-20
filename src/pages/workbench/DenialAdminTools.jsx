import { useState } from 'react';
import { typeOf } from '../../lib/denials';
import { scopeOf, stepsNeedRecheck, verifySteps, setStepsActive, planCopy, applyCopy } from '../../lib/denialSteps';
import { readStepsFile, compareStepsImport, applyStepsImport, downloadStepsTemplate } from '../../lib/denialStepsImport';
import DenialStepsModal from './DenialStepsModal';
import SopText from './SopText';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';
import { confirmDialog, alertDialog } from '../../components/shared/Dialog';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** Every steps entry of one code — common, each client, each payer — to add / edit / verify / (re)activate (4.3). */
export function CodeStepsModal({ code, steps, ctx, user, onClose, onChanged }) {
  const [editing, setEditing] = useState(null);   // { scope, target, entry }
  const [addScope, setAddScope] = useState('');
  const [addClient, setAddClient] = useState('');
  const entries = steps.filter(s => s.code_id === code.id);
  const targetName = s => s.scope === 'client' ? ctx.clients.find(c => c.id === s.client_id)?.name ?? `Client #${s.client_id}`
    : s.scope === 'payer' ? ctx.payers.find(p => p.id === s.payer_id)?.name ?? `Payer #${s.payer_id}` : null;
  const order = { common: 0, client: 1, payer: 2 };
  const sorted = [...entries].sort((a, b) => (b.active !== false) - (a.active !== false) || order[a.scope] - order[b.scope]
    || (targetName(a) ?? '').localeCompare(targetName(b) ?? ''));
  const hasCommon = entries.some(s => s.scope === 'common' && s.active !== false);

  async function run(fn) { if (await fn()) onChanged(); }
  const verify = e => run(() => verifySteps(e, user));
  async function toggle(e) {
    const off = e.active !== false;
    if (!await confirmDialog(off
      ? { title: 'Make these steps inactive?', message: 'They will no longer show. Nothing is deleted.', confirmText: 'Make Inactive', tone: 'warning' }
      : { title: 'Reactivate these steps?', message: targetName(e) ?? 'Common steps', confirmText: 'Reactivate' })) return;
    if (!off && steps.some(s => s.id !== e.id && s.active !== false && s.code_id === e.code_id && s.scope === e.scope
      && s.client_id === e.client_id && s.payer_id === e.payer_id)) {
      return alertDialog({ title: 'Can’t reactivate', message: 'There are already active steps for this layer. Make those inactive first.', tone: 'warning' });
    }
    run(() => setStepsActive(e, !off, user));
  }

  return (
    <Modal title={`Steps for ${typeOf(code.code_type).label} ${code.code}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {code.plain_reason && <p className="text-sm text-muted" style={{ marginTop: 0 }}>{code.plain_reason}</p>}
        {sorted.length === 0 && <p className="text-sm text-muted">No steps yet.</p>}
        {sorted.map(e => {
          const s = scopeOf(e.scope);
          return (
            <div key={e.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8, opacity: e.active === false ? 0.6 : 1 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                <span className="bold">{s.icon} {e.scope === 'common' ? 'Common 3Gen steps' : `${s.label} — ${targetName(e)}`}</span>
                {e.active === false && <span className="badge badge-gray">Inactive</span>}
                {e.active !== false && stepsNeedRecheck(e) && <span className="badge badge-orange">{e.verified_at ? 'Needs re-check' : 'Not verified'}</span>}
                {e.verified_at && <span className="text-sm text-muted">verified {fmtDate(e.verified_at)}</span>}
                <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  {e.active !== false && <button className="btn-sm" onClick={() => verify(e)}>✓ Verified</button>}
                  {e.active !== false && (
                    <button className="btn-sm" onClick={() => setEditing({
                      scope: e.scope, entry: e,
                      target: e.scope === 'common' ? null : { id: e.scope === 'client' ? e.client_id : e.payer_id, name: targetName(e) },
                    })}>✎</button>
                  )}
                  <button className="btn-sm" title={e.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => toggle(e)}>
                    {e.active === false ? '↺' : '⊘'}
                  </button>
                </span>
              </div>
              <SopText text={e.steps} style={{ fontSize: 13 }} />
            </div>
          );
        })}

        <div className="card" style={{ background: 'var(--surface-2)', marginTop: 4 }}>
          <div className="bold text-sm" style={{ marginBottom: 6 }}>Add steps</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {!hasCommon && <button className="btn-sm" onClick={() => setEditing({ scope: 'common', target: null, entry: null })}>⬜ Common steps</button>}
            <select value={addClient} onChange={e => setAddClient(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">Client…</option>
              {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
            <button className="btn-sm" disabled={!addClient} onClick={() => {
              const c = ctx.clients.find(x => String(x.id) === addClient);
              setEditing({ scope: 'client', target: { id: c.id, name: c.name }, entry: null });
            }}>🟨 Add client steps</button>
            <button className="btn-sm" onClick={() => setAddScope(addScope === 'payer' ? '' : 'payer')}>🟦 Add payer steps</button>
          </div>
          {addScope === 'payer' && (
            <div style={{ marginTop: 6 }}>
              <PayerSearch payers={ctx.payers} onSelect={p => { setAddScope(''); setEditing({ scope: 'payer', target: { id: p.id, name: p.name }, entry: null }); }} />
            </div>
          )}
        </div>
        <div className="form-actions">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>

      {editing && (
        <DenialStepsModal code={code} scope={editing.scope} target={editing.target} existing={editing.entry}
          allSteps={steps} sops={ctx.sops} user={user}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </Modal>
  );
}

/** Copy common (or another client's) steps to a client for the ticked codes (4.3). Copies start unverified. */
export function CopyStepsModal({ codeIds, steps, ctx, user, onClose, onSaved }) {
  const [from, setFrom] = useState('common');       // 'common' or a client id
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = to ? planCopy(steps, codeIds, from === 'common' ? { scope: 'common' } : { scope: 'client', clientId: Number(from) }, Number(to)) : null;
  const toName = ctx.clients.find(c => String(c.id) === to)?.name;

  async function copy() {
    if (!await confirmDialog({
      title: `Copy ${plan.copy.length} to ${toName}?`,
      message: 'The copies start as “not verified” so the client lead can tailor and verify them.',
      confirmText: 'Copy',
    })) return;
    setBusy(true);
    await applyCopy(plan, Number(to), user);
    setBusy(false);
    onSaved();
  }

  return (
    <Modal title={`Copy steps — ${codeIds.length} code${codeIds.length === 1 ? '' : 's'} ticked`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="field">
          <label>Copy from</label>
          <select value={from} onChange={e => setFrom(e.target.value)}>
            <option value="common">Common 3Gen steps</option>
            {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>Client: {c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>To client</label>
          <select value={to} onChange={e => setTo(e.target.value)}>
            <option value="">— Choose —</option>
            {ctx.clients.filter(c => String(c.id) !== from).map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
        {plan && (
          <div className="text-sm">
            <span className="badge badge-green">{plan.copy.length} will be copied</span>{' '}
            {plan.skipped > 0 && <span className="badge badge-gray">{plan.skipped} skipped — {toName} already has steps</span>}{' '}
            {plan.missing > 0 && <span className="badge badge-orange">{plan.missing} have nothing to copy</span>}
          </div>
        )}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={copy} disabled={busy || !plan?.copy.length}>{busy ? 'Copying…' : 'Copy'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Bulk import of steps from the Excel template, with a preview (4.3). */
export function StepsImportModal({ codes, steps, ctx, user, onClose, onSaved }) {
  const [read, setRead] = useState(null);         // { rows } or { error }
  const [mode, setMode] = useState('skip');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const diff = read?.rows ? compareStepsImport(read.rows, { codes, steps, ...ctx }, mode) : null;

  async function pick(f) {
    setRead(null);
    if (!f) return;
    setBusy(true);
    try { setRead(await readStepsFile(f)); } catch { setRead({ error: 'This file couldn’t be read. Please use the .xlsx template.' }); }
    setBusy(false);
  }
  async function save() {
    if (!await confirmDialog({
      title: 'Import these steps?',
      message: `${diff.add.length} new${mode === 'replace' ? `, ${diff.update.length} replaced` : ''}. Rows with errors are left out. Nothing is deleted.`,
      confirmText: 'Import',
    })) return;
    setBusy(true);
    setDone(await applyStepsImport(diff, user));
    setBusy(false);
  }

  return (
    <Modal title="Import denial steps from Excel" onClose={done ? onSaved : onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!done && (
          <>
            <p className="text-sm text-muted" style={{ marginTop: 0 }}>
              One row per code and layer. Codes must already be in the Denial library; clients and payers must exist.
              <button type="button" className="btn-sm" style={{ marginLeft: 8 }} onClick={downloadStepsTemplate}>⬇ Download template</button>
            </p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e => pick(e.target.files?.[0] ?? null)} />
            <div className="row text-sm" style={{ gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              <label className="row" style={{ gap: 4, cursor: 'pointer' }}>
                <input type="radio" checked={mode === 'skip'} onChange={() => setMode('skip')} /> Skip codes that already have steps
              </label>
              <label className="row" style={{ gap: 4, cursor: 'pointer' }}>
                <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace existing steps
              </label>
            </div>
            {busy && <div className="text-sm text-muted" style={{ marginTop: 8 }}>Working…</div>}
            {read?.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{read.error}</p>}
            {diff && (
              <div className="card" style={{ marginTop: 10, background: 'var(--surface-2)' }}>
                <div className="text-sm">
                  <span className="badge badge-green">{diff.add.length} new</span>{' '}
                  {mode === 'replace' && <span className="badge badge-blue">{diff.update.length} will be replaced</span>}{' '}
                  {diff.skipped > 0 && <span className="badge badge-gray">{diff.skipped} skipped (already have steps)</span>}{' '}
                  {diff.errors.length > 0 && <span className="badge badge-red">{diff.errors.length} with errors</span>}
                </div>
                {diff.errors.slice(0, 15).map(e => (
                  <div key={e.line} className="text-sm" style={{ color: 'var(--danger)', marginTop: 2 }}>Row {e.line}: {e.message}</div>
                ))}
                {diff.errors.length > 15 && <div className="text-sm text-muted">…and {diff.errors.length - 15} more.</div>}
              </div>
            )}
          </>
        )}
        {done && <p className="text-sm">✓ Imported: {done.added} new, {done.updated} replaced. New entries start as “not verified”.</p>}
        <div className="form-actions">
          {done
            ? <button className="btn-primary" onClick={onSaved}>Done</button>
            : (
              <>
                <button className="btn-sm" onClick={onClose}>Cancel</button>
                <button className="btn-primary" onClick={save}
                  disabled={busy || !diff || (diff.add.length + (mode === 'replace' ? diff.update.length : 0) === 0)}>Import</button>
              </>
            )}
        </div>
      </div>
    </Modal>
  );
}
