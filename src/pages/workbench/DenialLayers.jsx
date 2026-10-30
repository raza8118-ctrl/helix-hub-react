import { useState, useEffect } from 'react';
import { layerEntry, stepsNeedRecheck, verifySteps, setStepsActive, loadPayerInfo, scopeOf } from '../../lib/denialSteps';
import { LIMIT_TYPES, labelOf } from '../../lib/payerOptions';
import { payerFormLink } from '../../lib/payerForms';
import DenialStepsModal from './DenialStepsModal';
import SopText from './SopText';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';
import { Button, Badge } from '../../components/ui';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const FORM_LABELS = { appeal: 'Appeal form', recon: 'Reconsideration form', corrected_claim: 'Corrected claim form' };

// One layer: its steps (or an empty message), linked SOP, verified / re-check badges and editor buttons
function LayerBox({ scope, title, entry, emptyText, highlight, sops, canEdit, onEdit, onVerify, onToggle, onOpenSop, children }) {
  const s = scopeOf(scope);
  const sop = entry?.sop_id ? sops.find(x => x.id === entry.sop_id) : null;
  return (
    <div className={`ui-layer${highlight ? ' hl' : ''}`}>
      <div className="ui-layer-h">
        <span className="ui-layer-t">{s.icon} {title}</span>
        {entry && stepsNeedRecheck(entry) && <Badge tone="warn">{entry.verified_at ? 'Needs re-check' : 'Not verified'}</Badge>}
        {entry?.verified_at && !stepsNeedRecheck(entry) && <span className="ui-small ui-text-good">verified {fmtDate(entry.verified_at)}</span>}
        {canEdit && (
          <span className="ui-row" style={{ gap: 4, marginLeft: 'auto' }}>
            {entry && <Button size="xs" variant="success" onClick={onVerify}>✓ Verified</Button>}
            <Button size="xs" onClick={onEdit}>{entry ? '✎ Edit steps' : '+ Add steps'}</Button>
            {entry && <Button size="xs" title="Make inactive" aria-label="Make inactive" onClick={onToggle}>⊘</Button>}
          </span>
        )}
      </div>
      {entry ? <SopText text={entry.steps} /> : <div className="ui-muted">{emptyText}</div>}
      {entry?.notes && <div className="ui-small" style={{ marginTop: 4 }}>📝 {entry.notes}</div>}
      {sop && (
        <div style={{ marginTop: 'var(--ui-s2)' }}>
          <Button size="sm" variant="ghost" onClick={() => onOpenSop(sop.id)}>📄 Open SOP: {sop.title} ›</Button>
        </div>
      )}
      {children}
    </div>
  );
}

// Appeals contacts, limits, forms and pinned notes from the Payer Directory
function PayerDirectoryInfo({ payer, client, onOpenPayer, onDeadline }) {
  const [info, setInfo] = useState({ key: null, data: null });
  const key = `${payer.id}|${client?.id ?? ''}`;
  useEffect(() => {
    let alive = true;
    loadPayerInfo(payer.id, client?.id ?? null).then(data => { if (alive) setInfo({ key, data }); });
    return () => { alive = false; };
  }, [payer.id, client?.id, key]);
  const data = info.key === key ? info.data : null;

  async function download(f) {
    const url = await payerFormLink(f.file_path, f.file_name);
    if (url) window.location.href = url;
  }

  return (
    <div className="ui-layer-sub">
      <div className="ui-row" style={{ marginBottom: 6 }}>
        <span className="ui-kv-l" style={{ margin: 0 }}>From the Payer Directory</span>
        <span className="ui-toolbar-sp" />
        {onDeadline && <Button size="xs" onClick={onDeadline}>⏰ Work out the deadline</Button>}
        <Button size="xs" onClick={() => onOpenPayer(payer)}>Open payer card ›</Button>
      </div>
      {!data && <div className="ui-text-muted">Loading…</div>}
      {data && !data.contacts.length && !data.limits.length && !data.forms.length && !data.notes.length && (
        <div className="ui-text-muted">No appeals contacts, limits or forms recorded for {payer.name} yet.</div>
      )}
      {data?.contacts.map(c => (
        <div key={c.id} style={{ marginBottom: 4 }}>
          <b>Appeals</b>
          {c.fax && <> · Fax {c.fax} <CopyButton value={c.fax} /></>}
          {c.phone && <> · Phone {c.phone}{c.phone_ext ? ` x${c.phone_ext}` : ''} <CopyButton value={c.phone} /></>}
          {c.mailing_address && (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {c.attention_line ? `${c.attention_line}\n` : ''}{c.mailing_address}{' '}
              <CopyButton value={[c.attention_line, c.mailing_address].filter(Boolean).join('\n')} label="Copy address" />
            </div>
          )}
          {c.portal_url && <div><a href={c.portal_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Appeals portal ↗</a></div>}
        </div>
      ))}
      {data?.limits.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {data.limits.map(l => (
            <div key={l.id}>
              ⏱ <b>{labelOf(LIMIT_TYPES, l.limit_type)}{l.level ? ` (level ${l.level})` : ''}</b>: {l.days ?? '?'} days
              {l.measured_from ? ` from ${String(l.measured_from).toLowerCase()}` : ''}
              {l.isOverride && <Badge tone="accent" style={{ marginLeft: 6 }}>{client?.name} contract</Badge>}
              {l.plan_id && <span className="ui-text-muted"> (specific plan)</span>}
              {l.notes && <span className="ui-text-muted"> — {l.notes}</span>}
            </div>
          ))}
        </div>
      )}
      {data?.forms.length > 0 && (
        <div className="ui-row" style={{ gap: 6, marginBottom: 4 }}>
          {data.forms.map(f => (
            <Button key={f.id} size="xs" onClick={() => download(f)} title={FORM_LABELS[f.form_type]}>⬇ {f.title}</Button>
          ))}
        </div>
      )}
      {data?.notes.map(n => <div key={n.id}>📌 {n.note}</div>)}
    </div>
  );
}

/**
 * "What to do" for one denial code (roadmap 4.2): 🟨 client steps (highlighted, when a client is picked) →
 * 🟦 payer rule + Payer Directory info (when a payer is picked) → ⬜ common 3Gen steps.
 */
export default function DenialLayers({ code, steps, ctx, client, payer, user, canEdit, onChanged, onOpenSop, onOpenPayer, onDeadline }) {
  const [editing, setEditing] = useState(null);   // { scope, target, entry }
  const clientEntry = client ? layerEntry(steps, code.id, 'client', client.id) : null;
  const payerEntry = payer ? layerEntry(steps, code.id, 'payer', payer.id) : null;
  const commonEntry = layerEntry(steps, code.id, 'common');

  async function verify(entry) {
    if (!await confirmDialog({ title: 'Mark these steps as verified?', message: 'Only after checking they are still correct.', confirmText: 'Mark Verified' })) return;
    if (await verifySteps(entry, user)) onChanged();
  }
  async function deactivate(entry) {
    if (!await confirmDialog({ title: 'Make these steps inactive?', message: 'They will no longer show. Nothing is deleted.', confirmText: 'Make Inactive', tone: 'warning' })) return;
    if (await setStepsActive(entry, false, user)) onChanged();
  }
  const box = (scope, target, entry) => ({
    scope, entry, sops: ctx.sops, canEdit, onOpenSop,
    onEdit: () => setEditing({ scope, target, entry }),
    onVerify: () => verify(entry),
    onToggle: () => deactivate(entry),
  });

  return (
    <div className="ui-stack" style={{ marginTop: 'var(--ui-s3)', gap: 'var(--ui-s2)' }}>
      {!client && !payer && (
        <div className="ui-muted">Pick a client and/or payer at the top to see their special steps too.</div>
      )}
      {client && (
        <LayerBox {...box('client', client, clientEntry)} title={`Client steps — ${client.name}`} highlight={!!clientEntry}
          emptyText={`No special steps for ${client.name} — follow the payer and common steps below.`} />
      )}
      {payer && (
        <LayerBox {...box('payer', payer, payerEntry)} title={`Payer rule — ${payer.name}`}
          emptyText={`No payer-specific steps for ${payer.name} and this code.`}>
          <PayerDirectoryInfo payer={payer} client={client} onOpenPayer={onOpenPayer} onDeadline={onDeadline} />
        </LayerBox>
      )}
      <LayerBox {...box('common', null, commonEntry)} title="Common 3Gen steps"
        emptyText="No common steps written for this code yet." />

      {editing && (
        <DenialStepsModal code={code} scope={editing.scope} target={editing.target} existing={editing.entry}
          allSteps={steps} sops={ctx.sops} user={user}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </div>
  );
}
