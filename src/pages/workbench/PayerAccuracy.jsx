import { useState } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { needsRecheck, VERIFY_DAYS } from '../../lib/payers';
import { confirmDialog } from '../../components/shared/Dialog';
import { Button, Field, FormActions, Notice, Modal } from '../../components/ui';

const fmtDay = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "✓ Verified …" or "⚠ Needs re-check" for one payer card entry (roadmap 1.6). */
export function VerifiedBadge({ row, names }) {
  const who = row.verified_by ? (names[row.verified_by] ?? row.verified_by) : null;
  if (!needsRecheck(row.verified_at)) {
    return (
      <span className="ui-small ui-text-good">
        ✓ Verified {fmtDay(row.verified_at)}{who ? ` by ${who}` : ''}
      </span>
    );
  }
  return (
    <span className="ui-small ui-text-warn"
      title={`Entries should be re-checked at least every ${VERIFY_DAYS} days`}>
      ⚠ Needs re-check · {row.verified_at ? `last verified ${fmtDay(row.verified_at)}${who ? ` by ${who}` : ''}` : 'never verified'}
    </span>
  );
}

/** "🚩 Report wrong info" — anyone can flag an entry for the payer's editors. */
export function ReportWrongInfo({ payer, section, table, entityId, entityTitle, user, onReported }) {
  const [open, setOpen]     = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  async function send() {
    const text = message.trim();
    if (!text) return setError('Tell us what looks wrong, e.g. “Fax number changed to …”.');
    setSaving(true);
    const result = await S.set('payer_reports', {
      payer_id: payer.id, section, entity_table: table, entity_id: entityId ?? null, entity_title: entityTitle ?? null,
      message: text, status: 'open', reported_by: user.emp_id, reported_by_name: user.name ?? user.emp_id,
    });
    setSaving(false);
    if (!result?.length) return setError('Could not send the report. The reports feature may not be set up yet — tell an admin.');
    logAudit({
      actor: user, action: 'report_payer_info', entityType: 'payer_report', entityId: result[0].id,
      details: { payer: payer.name, payer_id: payer.id, section },
    });
    setOpen(false); setMessage(''); setError('');
    onReported?.();
  }

  return (
    <>
      <Button size="xs" title="Report wrong or outdated info" onClick={() => setOpen(true)}>
        🚩 Report
      </Button>
      {open && (
        <Modal title={`Report wrong info — ${payer.name}`} onClose={() => setOpen(false)}>
          <div>
            <p className="ui-muted" style={{ margin: '0 0 var(--ui-s3)' }}>
              {section}{entityTitle ? ` → ${entityTitle}` : ''}. Editors of the Payer Directory will see your report and fix it.
            </p>
            <Field label="What’s wrong? (no patient information)">
              <textarea rows={3} value={message} autoFocus onChange={e => { setMessage(e.target.value); setError(''); }}
                placeholder="e.g. Appeals fax is now 800-555-0100 per rep on 10/18" />
            </Field>
            {error && <Notice tone="bad">{error}</Notice>}
            <FormActions>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={send} disabled={saving}>{saving ? 'Sending…' : 'Send Report'}</Button>
            </FormActions>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Editors' banner listing a payer's open reports, each with "Resolve". */
export function OpenReports({ payer, reports, user, onChanged }) {
  const open = (reports ?? []).filter(r => r.status === 'open')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!open.length) return null;

  async function resolve(r) {
    if (!await confirmDialog({
      title: 'Mark this report resolved?',
      message: `“${r.message}”\n\nResolve it once the entry has been checked and corrected (or confirmed correct).`,
      confirmText: 'Resolve',
    })) return;
    const ok = await S.update('payer_reports', {
      status: 'resolved', resolved_by: user.emp_id, resolved_at: new Date().toISOString(),
    }, { id: r.id });
    if (!ok) return;
    logAudit({
      actor: user, action: 'resolve_payer_report', entityType: 'payer_report', entityId: r.id,
      details: { payer: payer.name, payer_id: payer.id, section: r.section },
    });
    onChanged?.();
  }

  return (
    <Notice tone="warn">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🚩 Open reports ({open.length})</div>
      <div className="ui-stack" style={{ gap: 8 }}>
        {open.map(r => (
          <div key={r.id} className="ui-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1, color: 'var(--text)' }}>
              <div className="bold">{[r.section, r.entity_title].filter(Boolean).join(' → ')}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{r.message}</div>
              <div className="ui-text-muted">{r.reported_by_name ?? r.reported_by} · {fmtDay(r.created_at)}</div>
            </div>
            <Button size="xs" onClick={() => resolve(r)}>✓ Resolve</Button>
          </div>
        ))}
      </div>
    </Notice>
  );
}
