import { useState, useEffect } from 'react';
import { layerEntry, stepsNeedRecheck, verifySteps, setStepsActive, loadPayerInfo, scopeOf } from '../../lib/denialSteps';
import { LIMIT_TYPES, labelOf } from '../../lib/payerOptions';
import { payerFormLink } from '../../lib/payerForms';
import DenialStepsModal from './DenialStepsModal';
import SopText from './SopText';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const FORM_LABELS = { appeal: 'Appeal form', recon: 'Reconsideration form', corrected_claim: 'Corrected claim form' };

// One layer: its steps (or an empty message), linked SOP, verified / re-check badges and editor buttons
function LayerBox({ scope, title, entry, emptyText, highlight, sops, canEdit, onEdit, onVerify, onToggle, onOpenSop, children }) {
  const s = scopeOf(scope);
  const sop = entry?.sop_id ? sops.find(x => x.id === entry.sop_id) : null;
  return (
    <div style={{
      border: `${highlight ? 2 : 1}px solid ${highlight ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 8,
      padding: 10, marginTop: 8, background: highlight ? 'var(--surface-2)' : undefined,
    }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <span className="bold">{s.icon} {title}</span>
        {entry && stepsNeedRecheck(entry) && <span className="badge badge-orange">{entry.verified_at ? 'Needs re-check' : 'Not verified'}</span>}
        {entry?.verified_at && !stepsNeedRecheck(entry) && <span className="text-sm text-muted">verified {fmtDate(entry.verified_at)}</span>}
        {canEdit && (
          <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
            {entry && <button className="btn-sm" onClick={onVerify}>✓ Verified</button>}
            <button className="btn-sm" onClick={onEdit}>{entry ? '✎ Edit steps' : '+ Add steps'}</button>
            {entry && <button className="btn-sm" title="Make inactive" onClick={onToggle}>⊘</button>}
          </span>
        )}
      </div>
      {entry ? <SopText text={entry.steps} /> : <div className="text-sm text-muted">{emptyText}</div>}
      {entry?.notes && <div className="text-sm" style={{ marginTop: 4 }}>📝 {entry.notes}</div>}
      {sop && (
        <button className="btn-sm" style={{ marginTop: 6 }} onClick={() => onOpenSop(sop.id)}>📄 Open SOP: {sop.title} ›</button>
      )}
      {children}
    </div>
  );
}

// Appeals contacts, limits, forms and pinned notes from the Payer Directory
function PayerDirectoryInfo({ payer, client, onOpenPayer }) {
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
    <div className="text-sm" style={{ marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span className="text-muted">From the Payer Directory</span>
        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onOpenPayer(payer)}>Open payer card ›</button>
      </div>
      {!data && <div className="text-muted">Loading…</div>}
      {data && !data.contacts.length && !data.limits.length && !data.forms.length && !data.notes.length && (
        <div className="text-muted">No appeals contacts, limits or forms recorded for {payer.name} yet.</div>
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
          {c.portal_url && <div><a href={c.portal_url} target="_blank" rel="noopener noreferrer">Appeals portal ↗</a></div>}
        </div>
      ))}
      {data?.limits.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {data.limits.map(l => (
            <div key={l.id}>
              ⏱ <b>{labelOf(LIMIT_TYPES, l.limit_type)}{l.level ? ` (level ${l.level})` : ''}</b>: {l.days ?? '?'} days
              {l.measured_from ? ` from ${String(l.measured_from).toLowerCase()}` : ''}
              {l.isOverride && <span className="badge badge-blue" style={{ marginLeft: 6 }}>{client?.name} contract</span>}
              {l.plan_id && <span className="text-muted"> (specific plan)</span>}
              {l.notes && <span className="text-muted"> — {l.notes}</span>}
            </div>
          ))}
        </div>
      )}
      {data?.forms.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {data.forms.map(f => (
            <button key={f.id} className="btn-sm" onClick={() => download(f)} title={FORM_LABELS[f.form_type]}>⬇ {f.title}</button>
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
export default function DenialLayers({ code, steps, ctx, client, payer, user, canEdit, onChanged, onOpenSop, onOpenPayer }) {
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
    <div style={{ marginTop: 8 }}>
      {!client && !payer && (
        <div className="text-sm text-muted">Pick a client and/or payer at the top to see their special steps too.</div>
      )}
      {client && (
        <LayerBox {...box('client', client, clientEntry)} title={`Client steps — ${client.name}`} highlight={!!clientEntry}
          emptyText={`No special steps for ${client.name} — follow the payer and common steps below.`} />
      )}
      {payer && (
        <LayerBox {...box('payer', payer, payerEntry)} title={`Payer rule — ${payer.name}`}
          emptyText={`No payer-specific steps for ${payer.name} and this code.`}>
          <PayerDirectoryInfo payer={payer} client={client} onOpenPayer={onOpenPayer} />
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
