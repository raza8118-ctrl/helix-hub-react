import { useState } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import {
  SOP_RECHECK_DAYS, statusOf, hasSopTemplate, sopSteps, sopNeedsRecheck,
} from '../../lib/sops';
import { sopTextToHtml, escHtml as esc } from '../../lib/sopText';
import { sopMediaLink } from '../../lib/sopMedia';
import SopEditorPage from './SopEditorPage';
import SopContent from './SopContent';
import { confirmDialog } from '../../components/shared/Dialog';
import CopyButton from '../../components/shared/CopyButton';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** Category › Software › Task above the SOP title. */
function trailOf(sop, lib) {
  const task = lib.tasks.find(t => t.id === sop.task_id);
  const software = task && lib.software.find(sw => sw.id === task.software_id);
  const category = software && lib.categories.find(c => c.id === software.category_id);
  return { task, software, category };
}

// Opens a plain, printable copy of the SOP in a new window (no sidebar or buttons), screenshots included
async function printSop(sop, trail, names) {
  const w = window.open('', '_blank');   // opened straight away so pop-up blockers allow it
  if (!w) return;
  w.document.write('<p style="font-family:Arial,sans-serif">Preparing the printout…</p>');
  const steps = sopSteps(sop).filter(s => s.text.trim());
  const links = {};
  await Promise.all(steps.flatMap(s => s.images).map(async img => { links[img.path] = await sopMediaLink(img.path); }));

  const section = (label, body) => body ? `<h2>${esc(label)}</h2>${body}` : '';
  const text = v => v?.trim() ? `<div class="text">${sopTextToHtml(v)}</div>` : '';
  const audience = [(sop.audience_teams ?? []).join(', '), sop.audience_notes].filter(Boolean).join(' — ');
  const stepHtml = s => `<li>${sopTextToHtml(s.text)}${s.tip ? `<div class="tip">Tip: ${sopTextToHtml(s.tip)}</div>` : ''}`
    + s.images.filter(img => links[img.path]).map(img => `<img src="${esc(links[img.path])}" alt="">`).join('')
    + (s.video ? '<div class="tip">🎬 A video for this step is available in Helix Hub.</div>' : '') + '</li>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sop.title)}</title>
<style>body{font:14px/1.5 Arial,sans-serif;margin:32px;color:#111}h1{font-size:22px;margin:4px 0 8px}
h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}.text ul,.text ol{margin:2px 0;padding-left:22px}
ol.steps>li{margin-bottom:12px;page-break-inside:avoid}.tip{color:#555;font-style:italic}.muted{color:#666;font-size:12px}
.important{border-left:4px solid #d97706;background:#fef3c7;padding:4px 8px;margin:4px 0}
li img{display:block;max-width:100%;max-height:420px;margin:6px 0;border:1px solid #ccc}</style>
</head><body>
<div class="muted">${esc([trail.category?.name, trail.software?.name, trail.task?.name].filter(Boolean).join(' › '))}</div>
<h1>${esc(sop.title)}</h1>${text(sop.summary)}
${sop.walkthrough_video?.path ? '<p class="muted">🎬 A walkthrough video is available in Helix Hub.</p>' : ''}
${section('Purpose', text(sop.purpose))}
${section('Who uses it', audience ? `<p>${esc(audience)}</p>` : '')}
${section('Before you start', text(sop.prerequisites))}
${section('Steps', steps.length ? `<ol class="steps">${steps.map(stepHtml).join('')}</ol>` : '')}
${section('What you should see', text(sop.expected_result))}
${section('If it goes wrong', text(sop.troubleshooting))}
<p class="muted" style="margin-top:24px">Owner: ${esc(names[sop.owner] ?? sop.owner ?? '—')} · Last verified: ${esc(fmtDate(sop.last_verified_at) || 'never')}
· Printed ${esc(fmtDate(new Date().toISOString()))}</p>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Wait for the screenshots so they appear on paper
  await Promise.all([...w.document.images].map(img => img.complete ? null
    : new Promise(res => { img.onload = res; img.onerror = res; })));
  w.focus();
  w.print();
}

/**
 * One SOP shown with the standard template (roadmap 3.2), with formatting, screenshots and videos (3.3):
 * Purpose · Who uses it · Before you start · Steps · What you should see · If it goes wrong · Owner / Last verified.
 */
export default function SopPage({ sop, lib, names, user, canEdit, onBack, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const trail = trailOf(sop, lib);
  const ready = hasSopTemplate(sop);
  const status = statusOf(sop.status);
  const stale = ready && sopNeedsRecheck(sop);

  if (editing) {
    return (
      <SopEditorPage sop={sop} user={user} trail={trail}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChanged(); }} />
    );
  }

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
        {sop.summary && <div className="text-muted" style={{ whiteSpace: 'pre-wrap' }}>{sop.summary}</div>}
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

      {ready && <SopContent sop={sop} showEmpty={canEdit} />}

      <div className="card mb-16 text-sm text-muted">
        Owner: <b>{names[sop.owner] ?? sop.owner ?? 'none yet'}</b>
        {' · '}Last verified: <b>{sop.last_verified_at
          ? `${fmtDate(sop.last_verified_at)}${sop.last_verified_by ? ` by ${names[sop.last_verified_by] ?? sop.last_verified_by}` : ''}`
          : 'never'}</b>
        {' · '}Updated {fmtDate(sop.updated_at)}
      </div>
    </div>
  );
}
