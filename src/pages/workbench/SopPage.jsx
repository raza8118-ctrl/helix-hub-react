import { useState } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import {
  SOP_SECTIONS, SOP_RECHECK_DAYS, statusOf, hasSopTemplate, sopSteps, sopNeedsRecheck, sopSectionFilled,
} from '../../lib/sops';
import SopContentEditor from './SopContentEditor';
import { confirmDialog } from '../../components/shared/Dialog';
import CopyButton from '../../components/shared/CopyButton';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const textBlock = { whiteSpace: 'pre-wrap', lineHeight: 1.55 };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Category › Software › Task above the SOP title. */
function trailOf(sop, lib) {
  const task = lib.tasks.find(t => t.id === sop.task_id);
  const software = task && lib.software.find(sw => sw.id === task.software_id);
  const category = software && lib.categories.find(c => c.id === software.category_id);
  return { task, software, category };
}

// Opens a plain, printable copy of the SOP in a new window (no sidebar or buttons)
function printSop(sop, trail, names) {
  const steps = sopSteps(sop).filter(s => s.text.trim());
  const section = (label, body) => body ? `<h2>${esc(label)}</h2>${body}` : '';
  const para = v => v?.trim() ? `<p>${esc(v)}</p>` : '';
  const audience = [(sop.audience_teams ?? []).join(', '), sop.audience_notes].filter(Boolean).join(' — ');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sop.title)}</title>
<style>body{font:14px/1.5 Arial,sans-serif;margin:32px;color:#111}h1{font-size:22px;margin:4px 0 8px}
h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}p{white-space:pre-wrap;margin:4px 0}
ol li{margin-bottom:8px;white-space:pre-wrap}.tip{color:#555;font-style:italic}.muted{color:#666;font-size:12px}</style>
</head><body>
<div class="muted">${esc([trail.category?.name, trail.software?.name, trail.task?.name].filter(Boolean).join(' › '))}</div>
<h1>${esc(sop.title)}</h1>${para(sop.summary)}
${section('Purpose', para(sop.purpose))}
${section('Who uses it', para(audience))}
${section('Before you start', para(sop.prerequisites))}
${section('Steps', steps.length ? `<ol>${steps.map(s => `<li>${esc(s.text)}${s.tip ? `<div class="tip">Tip: ${esc(s.tip)}</div>` : ''}</li>`).join('')}</ol>` : '')}
${section('What you should see', para(sop.expected_result))}
${section('If it goes wrong', para(sop.troubleshooting))}
<p class="muted" style="margin-top:24px">Owner: ${esc(names[sop.owner] ?? sop.owner ?? '—')} · Last verified: ${esc(fmtDate(sop.last_verified_at) || 'never')}
· Printed ${esc(fmtDate(new Date().toISOString()))}</p>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

/**
 * One SOP shown with the standard template (roadmap 3.2):
 * Purpose · Who uses it · Before you start · Steps · What you should see · If it goes wrong · Owner / Last verified.
 */
export default function SopPage({ sop, lib, names, user, canEdit, onBack, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const trail = trailOf(sop, lib);
  const ready = hasSopTemplate(sop);
  const steps = sopSteps(sop).filter(s => s.text.trim());
  const status = statusOf(sop.status);
  const stale = ready && sopNeedsRecheck(sop);

  async function markVerified() {
    if (!await confirmDialog({
      title: 'Mark this SOP as verified today?',
      message: 'Only do this after you have followed the steps and they still match the software.',
      confirmText: 'Mark Verified',
    })) return;
    setVerifying(true);
    const at = new Date().toISOString();
    const result = await S.update('sops', { last_verified_at: at, last_verified_by: user.emp_id }, { id: sop.id });
    setVerifying(false);
    if (!result?.length) return;
    logAudit({ actor: user, action: 'sop_verify', entityType: 'sop', entityId: sop.id });
    onChanged();
  }

  function renderSection({ key, label }) {
    const filled = ready && sopSectionFilled(sop, key);
    if (!filled && !canEdit) return null;
    let body;
    if (!filled) body = <div className="text-sm text-muted">Not filled in yet.</div>;
    else if (key === 'audience') body = (
      <div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(sop.audience_teams ?? []).map(t => <span key={t} className="badge badge-blue">{t}</span>)}
        </div>
        {sop.audience_notes && <div style={{ ...textBlock, marginTop: 6 }}>{sop.audience_notes}</div>}
      </div>
    );
    else if (key === 'steps') body = (
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
        {steps.map((s, i) => (
          <li key={i} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span style={{
              flex: '0 0 28px', height: 28, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13,
            }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={textBlock}>{s.text}</div>
              {s.tip && <div className="text-sm" style={{ ...textBlock, marginTop: 4, color: 'var(--text-muted)' }}>💡 {s.tip}</div>}
              <div className="text-sm text-muted" style={{
                marginTop: 8, padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 6, textAlign: 'center',
              }}>
                🖼 Screenshot coming soon
              </div>
            </div>
          </li>
        ))}
      </ol>
    );
    else body = <div style={textBlock}>{sop[key]}</div>;
    return (
      <div key={key} className="card mb-16">
        <div className="card-title" style={{ marginBottom: 8 }}>{label}</div>
        {body}
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-sm" onClick={onBack}>← Back to library</button>
        <span style={{ marginLeft: 'auto' }} className="row">
          {ready && <button className="btn-sm" onClick={() => printSop(sop, trail, names)}>🖨 Print</button>}
          {canEdit && ready && <button className="btn-sm" onClick={markVerified} disabled={verifying}>{verifying ? 'Saving…' : '✓ Mark as verified today'}</button>}
          {canEdit && ready && <button className="btn-primary btn-sm" onClick={() => setEditing(true)}>✎ Edit content</button>}
        </span>
      </div>

      <div className="card mb-16">
        <div className="text-sm text-muted">
          {[trail.category?.name, trail.software?.name, trail.task?.name].filter(Boolean).join(' › ')}
        </div>
        <div className="page-title" style={{ margin: '4px 0' }}>📄 {sop.title}</div>
        {sop.summary && <div className="text-muted" style={textBlock}>{sop.summary}</div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {canEdit && <span className={`badge ${status.badge}`}>{status.label}</span>}
          {stale && <span className="badge badge-orange" title={`Not verified in the last ${SOP_RECHECK_DAYS} days`}>Needs re-check</span>}
          {sop.active === false && <span className="badge badge-gray">Inactive</span>}
        </div>
        {trail.software?.portal_url && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <span className="text-sm text-muted">{trail.software.name} login:</span>
            <a className="btn-sm" href={trail.software.portal_url} target="_blank" rel="noopener noreferrer">Open login page ↗</a>
            <CopyButton value={trail.software.portal_url} label="Copy link" />
          </div>
        )}
      </div>

      {!ready && (
        <div className="card mb-16 text-muted">
          The SOP page template isn’t set up yet. An admin needs to run the SOP template database update
          (<code>20261020_sop_template.sql</code>) in Supabase.
        </div>
      )}

      {ready && !canEdit && !SOP_SECTIONS.some(s => sopSectionFilled(sop, s.key)) && (
        <div className="card mb-16 text-muted">This SOP doesn’t have any content yet.</div>
      )}

      {ready && SOP_SECTIONS.map(renderSection)}

      <div className="card mb-16 text-sm text-muted">
        Owner: <b>{names[sop.owner] ?? sop.owner ?? 'none yet'}</b>
        {' · '}Last verified: <b>{sop.last_verified_at
          ? `${fmtDate(sop.last_verified_at)}${sop.last_verified_by ? ` by ${names[sop.last_verified_by] ?? sop.last_verified_by}` : ''}`
          : 'never'}</b>
        {' · '}Updated {fmtDate(sop.updated_at)}
      </div>

      {editing && (
        <SopContentEditor sop={sop} user={user} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }} />
      )}
    </div>
  );
}
