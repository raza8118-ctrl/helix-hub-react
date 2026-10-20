import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { hasAccess } from '../../lib/access';
import {
  SOP_RECHECK_DAYS, statusOf, hasSopTemplate, sopSteps, sopNeedsRecheck,
} from '../../lib/sops';
import {
  loadSopVersions, versionStates, sopAsVersion, hasUnpublishedChanges, mustAcknowledge, recordSopRead, acknowledgeSop,
} from '../../lib/sopVersions';
import { sopTextToHtml, escHtml as esc } from '../../lib/sopText';
import { sopMediaLink } from '../../lib/sopMedia';
import SopEditorPage from './SopEditorPage';
import SopContent from './SopContent';
import SopTracking from './SopTracking';
import { PublishVersionModal, VersionHistory, ClientCopyModal } from './SopVersions';
import { confirmDialog } from '../../components/shared/Dialog';
import CopyButton from '../../components/shared/CopyButton';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

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
 * One SOP shown with the standard template (roadmap 3.2), with formatting, screenshots and videos (3.3),
 * and published versions, client SOPs and acknowledgement (3.4).
 * Readers see the current published version; editors can switch to the working copy or any older version.
 */
export default function SopPage({ sop, lib, meta, names, user, canEdit, onBack, onChanged, onOpenSop }) {
  const versionsReady = meta != null;
  const [versions, setVersions] = useState(undefined);   // full versions with snapshots; undefined = loading
  const [reloadKey, setReloadKey] = useState(0);
  const [viewId, setViewId] = useState(null);             // null = default view, 'working', or a version id
  const [editing, setEditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [acking, setAcking] = useState(false);
  const [ackedNow, setAckedNow] = useState(null);         // version id acknowledged in this visit

  useEffect(() => {
    let alive = true;
    if (versionsReady) loadSopVersions(sop.id).then(list => { if (alive) setVersions(list ?? []); });
    return () => { alive = false; };
  }, [sop.id, versionsReady, reloadKey]);

  const list = versionsReady ? (versions ?? []) : [];
  const states = versionStates(list);
  const loadingVersions = versionsReady && versions === undefined;

  // Which content is on screen: a version, or null for the working copy / an SOP from before versions
  let shown;
  if (!canEdit) shown = states.current;
  else if (viewId === 'working') shown = null;
  else if (viewId != null) shown = list.find(v => v.id === viewId) ?? null;
  else shown = states.current;
  const legacy = !versionsReady || list.length === 0;     // nothing published as a version yet
  const display = shown ? sopAsVersion(sop, shown) : sop;
  const readerHasNothing = !canEdit && !loadingVersions && !shown && !legacy;   // only upcoming versions so far
  const notCurrent = !!shown && shown !== states.current;

  const trail = trailOf(sop, lib);
  const ready = hasSopTemplate(sop);
  const status = statusOf(sop.status);
  const stale = ready && sopNeedsRecheck(sop);
  const unpublished = canEdit && versionsReady && !loadingVersions && hasUnpublishedChanges(sop, states.latest);
  const client = sop.client_id != null ? (lib.clients ?? []).find(c => c.id === sop.client_id) : null;
  const copiedFrom = sop.copied_from != null ? lib.sops.find(s => s.id === sop.copied_from) : null;
  const canTrack = hasAccess(user, 'sops_tracking');

  // Count this opening of the current version (first/last opened, how many times)
  const currentId = states.current?.id ?? null;
  const empId = user.emp_id;
  useEffect(() => {
    if (currentId) recordSopRead(sop.id, currentId, { emp_id: empId });
  }, [sop.id, currentId, empId]);

  if (editing) {
    return (
      <SopEditorPage sop={sop} user={user} trail={trail}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); setViewId('working'); onChanged(); }} />
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

  async function acknowledge() {
    if (!await confirmDialog({
      title: `Acknowledge v${states.current.version_no}?`,
      message: `“${display.title}” — you confirm you have read and understood this SOP.`,
      confirmText: 'I Acknowledge',
    })) return;
    setAcking(true);
    const ok = await acknowledgeSop(sop.id, states.current, user);
    setAcking(false);
    if (!ok) return;
    setAckedNow(states.current.id);
    onChanged();
  }

  // Acknowledgement status for the current version (only when it is on screen)
  const ackRow = currentId ? meta?.myReads.find(r => r.version_id === currentId && r.acknowledged_at) : null;
  const needsAck = !!shown && shown === states.current && mustAcknowledge(user, states.current);
  const acked = ackedNow === currentId || !!ackRow;

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-sm" onClick={onBack}>← Back to library</button>
        <span style={{ marginLeft: 'auto', flexWrap: 'wrap', gap: 6 }} className="row">
          {ready && !readerHasNothing && <button className="btn-sm" onClick={() => printSop(display, trail, names)}>🖨 Print</button>}
          {canEdit && ready && <button className="btn-sm" onClick={markVerified} disabled={verifying}>{verifying ? 'Saving…' : '✓ Mark as verified today'}</button>}
          {canEdit && versionsReady && sop.client_id == null && (
            <button className="btn-sm" onClick={() => setCopying(true)}>📋 Make a client copy</button>
          )}
          {canEdit && ready && <button className="btn-sm" onClick={() => setEditing(true)}>✎ Edit content</button>}
          {canEdit && ready && versionsReady && (
            <button className="btn-primary btn-sm" onClick={() => setPublishing(true)} disabled={loadingVersions || !unpublished}
              title={unpublished ? 'Publish the working copy as a new version' : 'No changes since the last version'}>
              📤 Publish new version
            </button>
          )}
        </span>
      </div>

      {canEdit && versionsReady && !loadingVersions && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <span className="text-sm text-muted">Showing:</span>
          {states.current && (
            <button className={shown === states.current ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={shown === states.current}
              onClick={() => setViewId(null)}>Published (v{states.current.version_no})</button>
          )}
          <button className={!shown ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={!shown}
            onClick={() => setViewId('working')}>Working copy</button>
          {unpublished && <span className="badge badge-yellow">Unpublished changes</span>}
          {notCurrent && <span className="badge badge-gray">Viewing v{shown.version_no}</span>}
        </div>
      )}

      {notCurrent && (
        <div className="card mb-16" style={{ border: '2px solid var(--danger)', fontWeight: 600 }}>
          {states.upcoming.includes(shown)
            ? `UPCOMING – v${shown.version_no} takes effect on ${fmtDay(shown.effective_date)}. Readers don’t see it yet.`
            : `ARCHIVED – not current. This is v${shown.version_no}${states.current ? `; the current version is v${states.current.version_no}` : ''}.`}
        </div>
      )}

      {states.upcoming.length > 0 && !notCurrent && (
        <div className="card mb-16 text-sm" style={{ borderLeft: '4px solid var(--accent)' }}>
          {canEdit
            ? `v${states.upcoming[0].version_no} takes effect on ${fmtDay(states.upcoming[0].effective_date)}.`
            : `An updated version of this SOP takes effect on ${fmtDay(states.upcoming[0].effective_date)}.`}
        </div>
      )}

      <div className="card mb-16" style={client ? { borderLeft: '4px solid var(--accent)' } : undefined}>
        <div className="text-sm text-muted">
          {[trail.category?.name, trail.software?.name, trail.task?.name].filter(Boolean).join(' › ')}
        </div>
        <div className="page-title" style={{ margin: '4px 0' }}>📄 {display.title}</div>
        {display.summary && <div className="text-muted" style={{ whiteSpace: 'pre-wrap' }}>{display.summary}</div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {client ? <span className="badge badge-blue">Client: {client.name}</span>
            : versionsReady && <span className="badge badge-gray">Common SOP (all clients)</span>}
          {shown && <span className="badge badge-green">v{shown.version_no} · effective {fmtDay(shown.effective_date)}</span>}
          {canEdit && <span className={`badge ${status.badge}`}>{status.label}</span>}
          {stale && <span className="badge badge-orange" title={`Not verified in the last ${SOP_RECHECK_DAYS} days`}>Needs re-check</span>}
          {sop.active === false && <span className="badge badge-gray">Inactive</span>}
        </div>
        {copiedFrom && canEdit && (
          <div className="text-sm text-muted" style={{ marginTop: 6 }}>
            Copied from the common SOP{' '}
            <button type="button" className="btn-sm" onClick={() => onOpenSop(copiedFrom.id)}>{copiedFrom.title} ›</button>
          </div>
        )}
        {trail.software?.portal_url && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <span className="text-sm text-muted">{trail.software.name} login:</span>
            <a className="btn-sm" href={trail.software.portal_url} target="_blank" rel="noopener noreferrer">Open login page ↗</a>
            <CopyButton value={trail.software.portal_url} label="Copy link" />
          </div>
        )}
      </div>

      {needsAck && (
        <div className="card mb-16" style={{ border: `2px solid ${acked ? 'var(--success)' : 'var(--warning)'}` }}>
          {acked
            ? <div className="text-sm">✓ You acknowledged v{states.current.version_no}{ackRow ? ` on ${fmtDate(ackRow.acknowledged_at)}` : ''}.</div>
            : (
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="text-sm">Please read this SOP and confirm you understand it.</span>
                <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={acknowledge} disabled={acking}>
                  {acking ? 'Saving…' : `I have read and understood this SOP (v${states.current.version_no})`}
                </button>
              </div>
            )}
        </div>
      )}

      {!ready && (
        <div className="card mb-16 text-muted">
          The SOP page template isn’t set up yet. An admin needs to run the SOP template database update
          (<code>20261020_sop_template.sql</code>) in Supabase.
        </div>
      )}

      {loadingVersions && <div className="card mb-16 text-muted">Loading…</div>}
      {readerHasNothing && <div className="card mb-16 text-muted">This SOP isn’t in effect yet.</div>}
      {ready && !loadingVersions && !readerHasNothing && <SopContent sop={display} showEmpty={canEdit && !shown} />}

      {canTrack && states.current && <SopTracking key={states.current.id} sop={sop} version={states.current} />}

      {canEdit && versionsReady && !loadingVersions && (
        <VersionHistory versions={list} states={states} names={names} viewingId={shown?.id ?? null}
          onView={v => setViewId(v === states.current ? null : v.id)} />
      )}

      <div className="card mb-16 text-sm text-muted">
        Owner: <b>{names[sop.owner] ?? sop.owner ?? 'none yet'}</b>
        {' · '}Last verified: <b>{sop.last_verified_at
          ? `${fmtDate(sop.last_verified_at)}${sop.last_verified_by ? ` by ${names[sop.last_verified_by] ?? sop.last_verified_by}` : ''}`
          : 'never'}</b>
        {shown ? ` · Published ${fmtDate(shown.published_at)}` : ` · Updated ${fmtDate(sop.updated_at)}`}
      </div>

      {publishing && (
        <PublishVersionModal sop={sop} versions={list} user={user} onClose={() => setPublishing(false)}
          onPublished={() => { setPublishing(false); setViewId(null); setReloadKey(k => k + 1); onChanged(); }} />
      )}
      {copying && (
        <ClientCopyModal sop={sop} lib={lib} user={user} onClose={() => setCopying(false)}
          onCopied={row => { setCopying(false); onChanged(); onOpenSop(row.id); }} />
      )}
    </div>
  );
}
