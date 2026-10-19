import { useState } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { needsRecheck, VERIFY_DAYS } from '../../lib/payers';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDay = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "✓ Verified …" or "⚠ Needs re-check" for one payer card entry (roadmap 1.6). */
export function VerifiedBadge({ row, names }) {
  const who = row.verified_by ? (names[row.verified_by] ?? row.verified_by) : null;
  if (!needsRecheck(row.verified_at)) {
    return (
      <span className="text-sm" style={{ color: 'var(--success)' }}>
        ✓ Verified {fmtDay(row.verified_at)}{who ? ` by ${who}` : ''}
      </span>
    );
  }
  return (
    <span className="text-sm" style={{ color: 'var(--warning)' }}
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
      <button type="button" className="btn-sm" title="Report wrong or outdated info"
        onClick={() => setOpen(true)} style={{ padding: '2px 8px', fontSize: 11 }}>
        🚩 Report
      </button>
      {open && (
        <Modal title={`Report wrong info — ${payer.name}`} onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <p className="text-sm text-muted" style={{ marginBottom: 10 }}>
              {section}{entityTitle ? ` → ${entityTitle}` : ''}. Editors of the Payer Directory will see your report and fix it.
            </p>
            <div className="field">
              <label>What’s wrong? (no patient information)</label>
              <textarea rows={3} value={message} autoFocus onChange={e => { setMessage(e.target.value); setError(''); }}
                placeholder="e.g. Appeals fax is now 800-555-0100 per rep on 10/18" />
            </div>
            {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
            <div className="form-actions">
              <button className="btn-sm" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={send} disabled={saving}>{saving ? 'Sending…' : 'Send Report'}</button>
            </div>
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
    <div style={{
      border: '1px solid var(--warning)', borderRadius: 'var(--radius)', padding: 10, marginBottom: 12,
      background: 'rgba(245,158,11,0.08)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🚩 Open reports ({open.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {open.map(r => (
          <div key={r.id} className="row" style={{ gap: 8, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="text-sm bold">{[r.section, r.entity_title].filter(Boolean).join(' → ')}</div>
              <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{r.message}</div>
              <div className="text-sm text-muted">{r.reported_by_name ?? r.reported_by} · {fmtDay(r.created_at)}</div>
            </div>
            <button className="btn-sm" onClick={() => resolve(r)}>✓ Resolve</button>
          </div>
        ))}
      </div>
    </div>
  );
}
