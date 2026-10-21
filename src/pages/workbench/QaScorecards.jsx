import { useState } from 'react';
import {
  STARTER_QA_CATEGORIES, STARTER_SCORECARDS, DEFAULT_PASS_MARK, addQaStarters, saveQaItem, setQaItemActive, moveCheckpoint,
} from '../../lib/qa';
import { TEAMS } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import { alertDialog } from '../../components/shared/Dialog';

const inactive = r => (r.active === false ? { opacity: 0.55 } : undefined);

/** Add / edit pop-up for a category, scorecard or checkpoint. */
function QaItemModal({ kind, row, scorecardId, setup, ctx, user, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    name: row?.name ?? '', description: row?.description ?? '', team: row?.team ?? '',
    pass_mark: row?.pass_mark ?? DEFAULT_PASS_MARK, text: row?.text ?? '', weight: row?.weight ?? 1,
    critical: !!row?.critical, category_id: row?.category_id ?? '', sop_id: row?.sop_id ?? '',
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, x) => setV(s => ({ ...s, [k]: x }));
  const title = { category: 'error category', scorecard: 'scorecard', checkpoint: 'checkpoint' }[kind];

  async function save() {
    let values;
    if (kind === 'category') {
      if (!v.name.trim()) return setError('Type a name.');
      values = { name: v.name.trim(), description: v.description.trim() || null, ...(row ? {} : { sort_order: setup.categories.length }) };
    } else if (kind === 'scorecard') {
      if (!v.name.trim()) return setError('Type a name.');
      const mark = Number(v.pass_mark);
      if (!(mark > 0 && mark <= 100)) return setError('The pass mark must be between 1 and 100.');
      values = { name: v.name.trim(), team: v.team || null, pass_mark: mark, description: v.description.trim() || null };
    } else {
      if (!v.text.trim()) return setError('Type what is checked.');
      const w = Number(v.weight);
      if (!(w > 0)) return setError('The weight must be more than 0.');
      const card = row?.scorecard_id ?? scorecardId;
      values = { scorecard_id: card, text: v.text.trim(), weight: w, critical: v.critical,
        category_id: v.category_id ? Number(v.category_id) : null, sop_id: v.sop_id ? Number(v.sop_id) : null,
        ...(row ? {} : { sort_order: setup.checkpoints.filter(c => c.scorecard_id === card).length }) };
    }
    setSaving(true);
    const saved = await saveQaItem(kind, row, values, user);
    setSaving(false);
    if (!saved) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title={`${row ? 'Edit' : 'Add'} ${title}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {kind !== 'checkpoint' && (
          <div className="field"><label>Name</label><input type="text" value={v.name} onChange={e => set('name', e.target.value)} /></div>
        )}
        {kind === 'scorecard' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 160px' }}><label>Team</label>
              <select value={v.team} onChange={e => set('team', e.target.value)}>
                <option value="">Any team</option>
                {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 120px' }}><label>Pass mark %</label>
              <input type="number" min="1" max="100" value={v.pass_mark} onChange={e => set('pass_mark', e.target.value)} />
            </div>
          </div>
        )}
        {kind !== 'checkpoint' && (
          <div className="field"><label>Description (optional)</label><textarea rows={2} value={v.description} onChange={e => set('description', e.target.value)} /></div>
        )}
        {kind === 'checkpoint' && (
          <>
            <div className="field"><label>What is checked</label>
              <input type="text" value={v.text} onChange={e => set('text', e.target.value)} placeholder="e.g. Correct next action taken for the denial" />
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="field" style={{ flex: '0 1 120px' }}><label>Weight</label>
                <input type="number" min="0.5" step="0.5" value={v.weight} onChange={e => set('weight', e.target.value)} />
              </div>
              <label className="row text-sm" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={v.critical} onChange={e => set('critical', e.target.checked)} />
                Critical — failing it makes the score 0
              </label>
            </div>
            <div className="field"><label>Error category when it fails</label>
              <select value={v.category_id} onChange={e => set('category_id', e.target.value)}>
                <option value="">— Auditor chooses —</option>
                {setup.categories.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>SOP that explains it</label>
              <select value={v.sop_id} onChange={e => set('sop_id', e.target.value)}>
                <option value="">— None —</option>
                {ctx.sops.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          </>
        )}
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** 🗂 Scorecards & categories (“Manage QA scorecards”): turned off, never deleted. */
export default function QaScorecards({ setup, ctx, user, onChanged }) {
  const [editor, setEditor] = useState(null);           // { kind, row, scorecardId }
  const [open, setOpen] = useState(() => new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState(false);

  const lower = s => s.trim().toLowerCase();
  const missing = STARTER_QA_CATEGORIES.filter(n => !setup.categories.some(c => lower(c.name) === lower(n))).length
    + STARTER_SCORECARDS.filter(s => !setup.scorecards.some(c => lower(c.name) === lower(s.name))).length;
  const shown = list => list.filter(r => showInactive || r.active !== false);
  const catName = id => setup.categories.find(c => c.id === id)?.name;
  const sopName = id => ctx.sops.find(s => s.id === id)?.title;

  async function run(fn) { setBusy(true); await fn(); setBusy(false); onChanged(); }
  async function starters() {
    setBusy(true);
    const r = await addQaStarters(setup, user);
    setBusy(false);
    onChanged();
    alertDialog({ title: 'Starters added', message: `${r.categories} error categories and ${r.scorecards} scorecards added. They are in our own words — please check and adjust them.`, tone: 'success' });
  }
  const toggle = id => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const onOff = (kind, r) => (
    <button className="btn-sm" disabled={busy} onClick={() => run(() => setQaItemActive(kind, r, r.active === false, user))}>
      {r.active === false ? 'Turn on' : 'Turn off'}
    </button>
  );

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-primary" onClick={() => setEditor({ kind: 'scorecard' })}>+ Scorecard</button>
          <button className="btn-sm" onClick={() => setEditor({ kind: 'category' })}>+ Error category</button>
          {missing > 0 && <button className="btn-sm" disabled={busy} onClick={starters}>Add starter scorecards ({missing})</button>}
          <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show turned-off
          </label>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">📋 Scorecards <span className="text-sm text-muted">· {shown(setup.scorecards).length}</span></div></div>
        {shown(setup.scorecards).length === 0 && <div className="text-sm text-muted">No scorecards yet — add one or use “Add starter scorecards”.</div>}
        {shown(setup.scorecards).map(card => {
          const points = shown(setup.checkpoints.filter(c => c.scorecard_id === card.id));
          const totalWeight = points.filter(p => p.active !== false).reduce((t, p) => t + Number(p.weight), 0);
          return (
            <div key={card.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', ...inactive(card) }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span role="button" style={{ cursor: 'pointer' }} onClick={() => toggle(card.id)} aria-expanded={open.has(card.id)}>
                  {open.has(card.id) ? '▾' : '▸'} <b>{card.name}</b>
                </span>
                <span className="text-sm text-muted">{card.team ?? 'Any team'} · pass {Number(card.pass_mark)}% · {points.length} checkpoints · total weight {totalWeight}</span>
                {card.active === false && <span className="badge badge-gray">Turned off</span>}
                <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  <button className="btn-sm" onClick={() => setEditor({ kind: 'scorecard', row: card })}>✏️ Edit</button>
                  {onOff('scorecard', card)}
                </span>
              </div>
              {open.has(card.id) && (
                <div style={{ paddingLeft: 18, marginTop: 6 }}>
                  {card.description && <div className="text-sm text-muted" style={{ marginBottom: 4 }}>{card.description}</div>}
                  {points.map((p, i) => (
                    <div key={p.id} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0', ...inactive(p) }}>
                      <span style={{ flex: '1 1 260px' }}>
                        {i + 1}. {p.text} <span className="text-sm text-muted">· weight {Number(p.weight)}</span>
                        {p.critical && <span className="badge badge-red" style={{ marginLeft: 6 }}>Critical</span>}
                        <div className="text-sm text-muted">
                          {catName(p.category_id) ?? 'Category chosen by the auditor'}{sopName(p.sop_id) ? ` · 📚 ${sopName(p.sop_id)}` : ''}
                        </div>
                      </span>
                      <button className="btn-sm" disabled={busy || i === 0} onClick={() => run(() => moveCheckpoint(points, i, -1))} aria-label="Move up">↑</button>
                      <button className="btn-sm" disabled={busy || i === points.length - 1} onClick={() => run(() => moveCheckpoint(points, i, 1))} aria-label="Move down">↓</button>
                      <button className="btn-sm" onClick={() => setEditor({ kind: 'checkpoint', row: p })}>✏️</button>
                      {onOff('checkpoint', p)}
                    </div>
                  ))}
                  <button className="btn-sm" style={{ marginTop: 4 }} onClick={() => setEditor({ kind: 'checkpoint', scorecardId: card.id })}>+ Checkpoint</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">🧩 Error categories <span className="text-sm text-muted">· {shown(setup.categories).length}</span></div></div>
        {shown(setup.categories).length === 0 && <div className="text-sm text-muted">No error categories yet.</div>}
        {shown(setup.categories).map(c => (
          <div key={c.id} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--border)', ...inactive(c) }}>
            <span style={{ flex: '1 1 240px' }}>{c.name}{c.description && <span className="text-sm text-muted"> — {c.description}</span>}</span>
            <button className="btn-sm" onClick={() => setEditor({ kind: 'category', row: c })}>✏️</button>
            {onOff('category', c)}
          </div>
        ))}
      </div>

      {editor && (
        <QaItemModal kind={editor.kind} row={editor.row ?? null} scorecardId={editor.scorecardId} setup={setup} ctx={ctx} user={user}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />
      )}
    </>
  );
}
