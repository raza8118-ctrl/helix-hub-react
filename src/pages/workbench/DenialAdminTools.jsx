import { useState } from 'react';
import { typeOf } from '../../lib/denials';
import { scopeOf, stepsNeedRecheck, verifySteps, setStepsActive, planCopy, applyCopy } from '../../lib/denialSteps';
import { readStepsFile, compareStepsImport, applyStepsImport, downloadStepsTemplate } from '../../lib/denialStepsImport';
import DenialStepsModal from './DenialStepsModal';
import SopText from './SopText';
import PayerSearch from '../../components/shared/PayerSearch';
import { Modal, Card, Field, Check, FormActions, Button, Badge, Notice, Toolbar, EmptyState } from '../../components/ui';
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
      <div className="ui-stack">
        {code.plain_reason && <p className="ui-muted" style={{ margin: 0 }}>{code.plain_reason}</p>}
        {sorted.length === 0 && <EmptyState compact title="No steps yet." />}
        {sorted.map(e => {
          const s = scopeOf(e.scope);
          return (
            <div key={e.id} className="ui-layer" style={e.active === false ? { opacity: 0.6 } : undefined}>
              <div className="ui-layer-h">
                <span className="ui-layer-t">{s.icon} {e.scope === 'common' ? 'Common 3Gen steps' : `${s.label} — ${targetName(e)}`}</span>
                {e.active === false && <Badge>Inactive</Badge>}
                {e.active !== false && stepsNeedRecheck(e) && <Badge tone="warn">{e.verified_at ? 'Needs re-check' : 'Not verified'}</Badge>}
                {e.verified_at && <span className="ui-small ui-text-good">verified {fmtDate(e.verified_at)}</span>}
                <span className="ui-row" style={{ gap: 4, marginLeft: 'auto' }}>
                  {e.active !== false && <Button size="xs" variant="success" onClick={() => verify(e)}>✓ Verified</Button>}
                  {e.active !== false && (
                    <Button size="xs" aria-label="Edit steps" onClick={() => setEditing({
                      scope: e.scope, entry: e,
                      target: e.scope === 'common' ? null : { id: e.scope === 'client' ? e.client_id : e.payer_id, name: targetName(e) },
                    })}>✎</Button>
                  )}
                  <Button size="xs" title={e.active === false ? 'Reactivate' : 'Make inactive'} aria-label={e.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => toggle(e)}>
                    {e.active === false ? '↺' : '⊘'}
                  </Button>
                </span>
              </div>
              <SopText text={e.steps} style={{ fontSize: 13 }} />
            </div>
          );
        })}

        <Card variant="soft" title="Add steps">
          <Toolbar>
            {!hasCommon && <Button size="sm" onClick={() => setEditing({ scope: 'common', target: null, entry: null })}>⬜ Common steps</Button>}
            <select value={addClient} onChange={e => setAddClient(e.target.value)} aria-label="Client">
              <option value="">Client…</option>
              {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
            <Button size="sm" disabled={!addClient} onClick={() => {
              const c = ctx.clients.find(x => String(x.id) === addClient);
              setEditing({ scope: 'client', target: { id: c.id, name: c.name }, entry: null });
            }}>🟨 Add client steps</Button>
            <Button size="sm" active={addScope === 'payer'} onClick={() => setAddScope(addScope === 'payer' ? '' : 'payer')}>🟦 Add payer steps</Button>
          </Toolbar>
          {addScope === 'payer' && (
            <div style={{ marginTop: 'var(--ui-s3)' }}>
              <PayerSearch payers={ctx.payers} onSelect={p => { setAddScope(''); setEditing({ scope: 'payer', target: { id: p.id, name: p.name }, entry: null }); }} />
            </div>
          )}
        </Card>
        <FormActions>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </FormActions>
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
      <div>
        <Field label="Copy from">
          <select value={from} onChange={e => setFrom(e.target.value)}>
            <option value="common">Common 3Gen steps</option>
            {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>Client: {c.name}</option>)}
          </select>
        </Field>
        <Field label="To client">
          <select value={to} onChange={e => setTo(e.target.value)}>
            <option value="">— Choose —</option>
            {ctx.clients.filter(c => String(c.id) !== from).map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </Field>
        {plan && (
          <div className="ui-row" style={{ gap: 6 }}>
            <Badge tone="good">{plan.copy.length} will be copied</Badge>
            {plan.skipped > 0 && <Badge>{plan.skipped} skipped — {toName} already has steps</Badge>}
            {plan.missing > 0 && <Badge tone="warn">{plan.missing} have nothing to copy</Badge>}
          </div>
        )}
        <FormActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={copy} disabled={busy || !plan?.copy.length}>{busy ? 'Copying…' : 'Copy'}</Button>
        </FormActions>
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
      <div className="ui-stack">
        {!done && (
          <>
            <div className="ui-row" style={{ justifyContent: 'space-between' }}>
              <span className="ui-muted" style={{ flex: '1 1 260px' }}>
                One row per code and layer. Codes must already be in the Denial library; clients and payers must exist.
              </span>
              <Button size="sm" onClick={downloadStepsTemplate}>⬇ Download template</Button>
            </div>
            <Field style={{ marginBottom: 0 }}>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={e => pick(e.target.files?.[0] ?? null)} aria-label="Steps file" />
            </Field>
            <div>
              <Check type="radio" checked={mode === 'skip'} onChange={() => setMode('skip')}>Skip codes that already have steps</Check>
              <Check type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')}>Replace existing steps</Check>
            </div>
            {busy && <EmptyState compact title="Working…" />}
            {read?.error && <Notice tone="bad">{read.error}</Notice>}
            {diff && (
              <Card variant="soft">
                <div className="ui-row" style={{ gap: 6 }}>
                  <Badge tone="good">{diff.add.length} new</Badge>
                  {mode === 'replace' && <Badge tone="info">{diff.update.length} will be replaced</Badge>}
                  {diff.skipped > 0 && <Badge>{diff.skipped} skipped (already have steps)</Badge>}
                  {diff.errors.length > 0 && <Badge tone="bad">{diff.errors.length} with errors</Badge>}
                </div>
                {diff.errors.slice(0, 15).map(e => (
                  <div key={e.line} className="ui-small ui-text-bad" style={{ marginTop: 4 }}>Row {e.line}: {e.message}</div>
                ))}
                {diff.errors.length > 15 && <div className="ui-muted">…and {diff.errors.length - 15} more.</div>}
              </Card>
            )}
          </>
        )}
        {done && <Notice tone="good">✓ Imported: {done.added} new, {done.updated} replaced. New entries start as “not verified”.</Notice>}
        <FormActions>
          {done
            ? <Button variant="primary" onClick={onSaved}>Done</Button>
            : (
              <>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={save}
                  disabled={busy || !diff || (diff.add.length + (mode === 'replace' ? diff.update.length : 0) === 0)}>Import</Button>
              </>
            )}
        </FormActions>
      </div>
    </Modal>
  );
}
