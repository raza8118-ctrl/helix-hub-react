import { useState, useEffect, useRef } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { TEAMS } from '../../lib/constants';
import { SOP_SECTIONS, sopSteps, hasSopMedia } from '../../lib/sops';
import { applySopFormat } from '../../lib/sopText';
import {
  MAX_IMAGES_PER_STEP, IMAGE_TYPES, VIDEO_TYPES, checkImageFile, checkVideoFile, uploadSopMedia,
} from '../../lib/sopMedia';
import SopContent from './SopContent';
import ScreenshotTool, { VideoConfirm } from './ScreenshotTool';
import { SopImage, SopVideo } from './SopMedia';
import { confirmDialog } from '../../components/shared/Dialog';

const hintOf = key => SOP_SECTIONS.find(s => s.key === key)?.hint;
let keySeq = 0;
const withKey = step => ({ ...step, key: ++keySeq });
const blankStep = () => withKey({ text: '', tip: '', images: [], video: null });
const TEXT_KEYS = ['purpose', 'audience_notes', 'prerequisites', 'expected_result', 'troubleshooting'];

// Steps as saved (no React keys, trimmed, empty steps dropped)
const cleanSteps = steps => steps
  .map(s => ({ text: s.text.trim(), tip: s.tip.trim(), images: s.images, video: s.video ?? null }))
  .filter(s => s.text || s.tip || s.images.length || s.video);

const FORMATS = [
  { kind: 'bold',      label: 'B',  title: 'Bold (select text first)', style: { fontWeight: 700 } },
  { kind: 'ul',        label: '•',  title: 'Bullet list' },
  { kind: 'ol',        label: '1.', title: 'Numbered list' },
  { kind: 'important', label: '⚠',  title: 'Important line' },
];

/** Textarea with a small formatting toolbar (bold, bullets, numbers, important). */
function FormatField({ value, onChange, rows = 3, placeholder }) {
  const ref = useRef(null);
  function apply(kind) {
    const el = ref.current;
    const next = applySopFormat(value, el.selectionStart, el.selectionEnd, kind);
    onChange(next.value);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.start, next.end); });
  }
  return (
    <div>
      <div className="row" style={{ gap: 4, marginBottom: 4 }}>
        {FORMATS.map(f => (
          <button key={f.kind} type="button" className="btn-sm" title={f.title} style={{ minWidth: 30, ...f.style }}
            onMouseDown={e => e.preventDefault()} onClick={() => apply(f.kind)}>{f.label}</button>
        ))}
      </div>
      <textarea ref={ref} rows={rows} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

// "Add screenshot" / "Add video" buttons that open the file picker
function PickButton({ label, accept, onPick, disabled }) {
  return (
    <label className="btn-sm" style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {label}
      <input type="file" accept={accept} hidden disabled={disabled}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
    </label>
  );
}

/**
 * Full-page SOP editor (roadmap 3.3): template sections with simple formatting, numbered steps with up to
 * 3 screenshots and one short video each, and an optional walkthrough video. Edit / Preview tabs.
 * Uploaded files are kept even if they are later removed from the SOP (nothing is deleted).
 */
export default function SopEditorPage({ sop, user, trail, onClose, onSaved }) {
  const mediaReady = hasSopMedia(sop);
  const [values, setValues] = useState(() => ({
    ...Object.fromEntries(TEXT_KEYS.map(k => [k, sop[k] ?? ''])),
    audience_teams: sop.audience_teams ?? [],
  }));
  const [steps, setSteps] = useState(() => {
    const list = sopSteps(sop).map(withKey);
    return list.length ? list : [blankStep()];
  });
  const [walkthrough, setWalkthrough] = useState(() => sop.walkthrough_video?.path ? sop.walkthrough_video : null);
  const [initial] = useState(() => JSON.stringify({ values, steps: cleanSteps(steps), walkthrough }));
  const [tab, setTab] = useState('edit');
  const [pending, setPending] = useState(null);   // { kind: 'image' | 'video', stepKey (null = walkthrough), file, duration }
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify({ values, steps: cleanSteps(steps), walkthrough }) !== initial;

  // Warn before closing the browser tab with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setV = patch => { setValues(v => ({ ...v, ...patch })); setError(''); };
  const setStep = (key, patch) => { setSteps(list => list.map(s => s.key === key ? { ...s, ...patch } : s)); setError(''); };
  const moveStep = (i, dir) => setSteps(list => {
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    return next;
  });
  const toggleTeam = team => setV({
    audience_teams: values.audience_teams.includes(team)
      ? values.audience_teams.filter(t => t !== team)
      : TEAMS.filter(t => t === team || values.audience_teams.includes(t)),
  });

  // ── Media ────────────────────────────────────────────────────────────────
  function startImage(step, file) {
    if (!mediaReady) return setError('Screenshots need the SOP media database update first (20261020b_sop_media.sql).');
    if (step.images.length >= MAX_IMAGES_PER_STEP) return setError(`A step can have up to ${MAX_IMAGES_PER_STEP} screenshots.`);
    const problem = checkImageFile(file);
    if (problem) return setError(problem);
    setError('');
    setPending({ kind: 'image', stepKey: step.key, file });
  }

  async function startVideo(stepKey, file) {
    if (!mediaReady) return setError('Videos need the SOP media database update first (20261020b_sop_media.sql).');
    setError('');
    const { error: problem, duration } = await checkVideoFile(file);
    if (problem) return setError(problem);
    setPending({ kind: 'video', stepKey, file, duration });
  }

  async function finishImage({ blob, width, height, ext }) {
    const { stepKey } = pending;
    setPending(null);
    setUploading('Uploading screenshot…');
    const result = await uploadSopMedia({ sopId: sop.id, kind: 'image', blob, ext, width, height, user });
    setUploading('');
    if (result.error) return setError(result.error);
    setSteps(list => list.map(s => s.key === stepKey ? { ...s, images: [...s.images, { path: result.path, width, height }] } : s));
  }

  async function finishVideo() {
    const { stepKey, file, duration } = pending;
    setPending(null);
    setUploading('Uploading video… (this can take a minute)');
    const ext = file.type === 'video/webm' ? 'webm' : 'mp4';
    const result = await uploadSopMedia({ sopId: sop.id, kind: 'video', blob: file, ext, duration, user });
    setUploading('');
    if (result.error) return setError(result.error);
    const video = { path: result.path, duration };
    if (stepKey == null) setWalkthrough(video); else setStep(stepKey, { video });
  }

  async function unlink(what, apply) {
    if (!await confirmDialog({
      title: `Remove this ${what}?`,
      message: what === 'step'
        ? 'The step and its screenshots/video will no longer show in this SOP once you save. Uploaded files are kept in the history.'
        : 'It will no longer show in this SOP once you save. The file itself is kept in the history.',
      confirmText: 'Remove', tone: 'warning',
    })) return;
    apply();
  }

  // Ctrl+V of a screenshot, or drag-and-drop of a picture/video, onto a step
  function onPaste(e, step) {
    const item = [...(e.clipboardData?.items ?? [])].find(it => it.kind === 'file' && it.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    startImage(step, file);
  }
  function onDrop(e, step) {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    if (file.type.startsWith('video/')) startVideo(step.key, file); else startImage(step, file);
  }

  // ── Save / cancel ───────────────────────────────────────────────────────
  async function save() {
    const list = cleanSteps(steps);
    if (list.some(s => !s.text)) return setError('Every step needs an instruction (a tip, screenshot or video on its own isn’t enough).');
    if (!await confirmDialog({ title: 'Save SOP content?', message: sop.title, confirmText: 'Save Changes' })) return;

    const text = v => v.trim() || null;
    const payload = {
      ...Object.fromEntries(TEXT_KEYS.map(k => [k, text(values[k])])),
      audience_teams: values.audience_teams,
      steps: list,
      updated_by: user.emp_id, updated_at: new Date().toISOString(),
    };
    if (mediaReady) payload.walkthrough_video = walkthrough;
    setSaving(true);
    const result = await S.update('sops', payload, { id: sop.id });
    setSaving(false);
    if (!result?.length) return setError('Could not save. Please try again.');
    logAudit({
      actor: user, action: 'sop_content_edit', entityType: 'sop', entityId: sop.id,
      details: {
        steps: list.length,
        images: list.reduce((n, s) => n + s.images.length, 0),
        videos: list.filter(s => s.video).length + (walkthrough ? 1 : 0),
      },
    });
    onSaved();
  }

  async function cancel() {
    if (dirty && !await confirmDialog({
      title: 'Leave without saving?', message: 'Your changes to this SOP will be lost.',
      confirmText: 'Leave', tone: 'warning',
    })) return;
    onClose();
  }

  const draft = { ...sop, ...values, steps: cleanSteps(steps), walkthrough_video: walkthrough };
  const busy = saving || !!uploading;

  const actions = (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn-sm" onClick={cancel} disabled={busy}>Cancel</button>
      <button className="btn-primary btn-sm" onClick={save} disabled={busy || !dirty}>{saving ? 'Saving…' : 'Save Changes'}</button>
    </span>
  );

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-sm" onClick={cancel} disabled={busy}>← Back to SOP</button>
        <span className="row" style={{ gap: 4 }}>
          {['edit', 'preview'].map(t => (
            <button key={t} type="button" className={tab === t ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === t}
              onClick={() => setTab(t)}>{t === 'edit' ? '✎ Edit' : '👁 Preview'}</button>
          ))}
        </span>
        <span style={{ marginLeft: 'auto' }}>{actions}</span>
      </div>

      <div className="card mb-16">
        <div className="text-sm text-muted">
          {[trail.category?.name, trail.software?.name, trail.task?.name].filter(Boolean).join(' › ')}
        </div>
        <div className="page-title" style={{ margin: '4px 0' }}>Editing: {sop.title}</div>
        <div className="text-sm" style={{
          marginTop: 8, padding: '8px 12px', borderRadius: 6, fontWeight: 600,
          background: 'var(--danger)', color: '#fff',
        }}>
          🔒 Never include patient information in text, screenshots or videos — use test/dummy accounts or black it out.
        </div>
        {!mediaReady && (
          <div className="text-sm text-muted" style={{ marginTop: 8 }}>
            Screenshots and videos will be available once an admin runs the SOP media database update
            (<code>20261020b_sop_media.sql</code>). Text can be edited now.
          </div>
        )}
        {uploading && <div className="text-sm" style={{ marginTop: 8 }}>⏳ {uploading}</div>}
        {error && <div className="text-sm" style={{ marginTop: 8, color: 'var(--danger)' }}>{error}</div>}
      </div>

      {tab === 'preview' && (
        <>
          <div className="text-sm text-muted mb-16">Preview — this is what readers will see after you save.</div>
          <SopContent sop={draft} showEmpty={false} />
        </>
      )}

      {tab === 'edit' && (
        <>
          <div className="card mb-16">
            <div className="card-title" style={{ marginBottom: 8 }}>▶ Walkthrough video (optional)</div>
            {walkthrough ? (
              <div>
                <SopVideo video={walkthrough} maxWidth={480} />
                <button type="button" className="btn-sm" style={{ marginTop: 6 }} disabled={busy}
                  onClick={() => unlink('video', () => setWalkthrough(null))}>✕ Remove video</button>
              </div>
            ) : (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <PickButton label="🎬 Add walkthrough video" accept={VIDEO_TYPES.join(',')} disabled={busy || !mediaReady}
                  onPick={f => startVideo(null, f)} />
                <span className="text-sm text-muted">MP4 or WEBM, up to 3 minutes and 25 MB.</span>
              </div>
            )}
          </div>

          <div className="card mb-16">
            <div className="field"><label>Purpose</label>
              <FormatField value={values.purpose} placeholder={hintOf('purpose')} onChange={v => setV({ purpose: v })} />
            </div>
            <div className="field">
              <label>Who uses it</label>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                {TEAMS.map(team => {
                  const on = values.audience_teams.includes(team);
                  return (
                    <button key={team} type="button" className={on ? 'btn-primary btn-sm' : 'btn-sm'}
                      aria-pressed={on} onClick={() => toggleTeam(team)}>{on ? '✓ ' : ''}{team}</button>
                  );
                })}
              </div>
              <input type="text" value={values.audience_notes} onChange={e => setV({ audience_notes: e.target.value })}
                placeholder="Anything more, e.g. “New joiners after Day 3”, “Only for client ABC”" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}><label>Before you start</label>
              <FormatField value={values.prerequisites} placeholder={hintOf('prerequisites')} onChange={v => setV({ prerequisites: v })} />
            </div>
          </div>

          <div className="card mb-16">
            <div className="card-title" style={{ marginBottom: 4 }}>Steps</div>
            <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
              Tip: take a screenshot (Win + Shift + S), click inside a step and press <b>Ctrl + V</b> — or drag a picture/video onto the step.
            </div>
            {steps.map((s, i) => (
              <div key={s.key} onPaste={e => onPaste(e, s)} onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, s)}
                style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <span className="bold">Step {i + 1}</span>
                  <span style={{ marginLeft: 'auto' }} className="row">
                    <button type="button" className="btn-sm" title="Move up" disabled={i === 0} onClick={() => moveStep(i, -1)}>▲</button>
                    <button type="button" className="btn-sm" title="Move down" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}>▼</button>
                    <button type="button" className="btn-sm" title="Remove step"
                      onClick={() => unlink('step', () => setSteps(list => list.filter(x => x.key !== s.key)))}>✕</button>
                  </span>
                </div>
                <FormatField rows={2} value={s.text} onChange={v => setStep(s.key, { text: v })}
                  placeholder="What to do, e.g. “Click Claims › Claim Status and enter the payer ID”" />
                <input type="text" value={s.tip} placeholder="Optional tip / watch out" style={{ marginTop: 6 }}
                  onChange={e => setStep(s.key, { tip: e.target.value })} />

                {s.images.length > 0 && (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {s.images.map(img => (
                      <div key={img.path} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        <SopImage image={img} alt={`Step ${i + 1} screenshot`} height={110} />
                        <button type="button" className="btn-sm" disabled={busy}
                          onClick={() => unlink('screenshot', () => setStep(s.key, { images: s.images.filter(x => x.path !== img.path) }))}>
                          ✕ Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {s.video && (
                  <div style={{ marginTop: 8 }}>
                    <SopVideo video={s.video} maxWidth={360} />
                    <button type="button" className="btn-sm" style={{ marginTop: 4 }} disabled={busy}
                      onClick={() => unlink('video', () => setStep(s.key, { video: null }))}>✕ Remove video</button>
                  </div>
                )}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <PickButton label={`📷 Add screenshot (${s.images.length}/${MAX_IMAGES_PER_STEP})`} accept={IMAGE_TYPES.join(',')}
                    disabled={busy || !mediaReady || s.images.length >= MAX_IMAGES_PER_STEP} onPick={f => startImage(s, f)} />
                  {!s.video && (
                    <PickButton label="🎬 Add short video" accept={VIDEO_TYPES.join(',')}
                      disabled={busy || !mediaReady} onPick={f => startVideo(s.key, f)} />
                  )}
                </div>
              </div>
            ))}
            <button type="button" className="btn-sm" onClick={() => setSteps(list => [...list, blankStep()])}>+ Add step</button>
          </div>

          <div className="card mb-16">
            <div className="field"><label>What you should see</label>
              <FormatField value={values.expected_result} placeholder={hintOf('expected_result')} onChange={v => setV({ expected_result: v })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}><label>If it goes wrong</label>
              <FormatField rows={4} value={values.troubleshooting} placeholder={hintOf('troubleshooting')} onChange={v => setV({ troubleshooting: v })} />
            </div>
          </div>
        </>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>{actions}</div>

      {pending?.kind === 'image' && (
        <ScreenshotTool file={pending.file} onCancel={() => setPending(null)} onUse={finishImage} />
      )}
      {pending?.kind === 'video' && (
        <VideoConfirm file={pending.file} duration={pending.duration} onCancel={() => setPending(null)} onUse={finishVideo} />
      )}
    </div>
  );
}
