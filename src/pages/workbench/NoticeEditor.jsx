import { useState } from 'react';
import { CATEGORIES, checkNotice, saveNotice, canPostEveryone } from '../../lib/board';
import { TEAMS } from '../../lib/constants';
import { today } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';
import SopText from './SopText';

/** Post / edit a notice (roadmap 10.3). Text uses the SOP formatting (**bold**, - lists, 1. steps, links). */
export default function NoticeEditor({ row, ctx, updates, user, onClose, onSaved }) {
  const everyone = canPostEveryone(user);
  const [v, setV] = useState(() => ({
    title: row?.title ?? '', body: row?.body ?? '', category: row?.category ?? 'process',
    teams: row?.teams ?? (everyone || !user.team ? [] : [user.team]), client_id: row?.client_id ?? null,
    pinned: row?.pinned ?? false, must_read: row?.must_read ?? false, show_from: row?.show_from ?? today(), show_until: row?.show_until ?? '',
    sop_id: row?.sop_id ?? null, payer_id: row?.payer_id ?? null, payer_update_id: row?.payer_update_id ?? null,
  }));
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, x) => setV(s => ({ ...s, [k]: x }));
  const payer = v.payer_id ? ctx.payers.find(p => p.id === v.payer_id) : null;
  const teamChoices = everyone ? TEAMS : TEAMS.filter(t => t === user.team);

  async function save() {
    const problem = checkNotice(v, user);
    if (problem) return setError(problem);
    setSaving(true);
    const saved = await saveNotice(row, v, user);
    setSaving(false);
    if (!saved) return setError('Could not save. Please try again.');
    onSaved(saved);
  }

  return (
    <Modal title={row ? 'Edit notice' : '📌 Post a notice'} onClose={onClose} wide>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '2 1 280px' }}><label>Title</label>
          <input type="text" value={v.title} maxLength={150} onChange={e => set('title', e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 180px' }}><label>Category</label>
          <select value={v.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>Text</span>
          <button type="button" className="btn-sm" onClick={() => setPreview(p => !p)}>{preview ? '✏️ Edit' : '👁 Preview'}</button>
        </label>
        {preview
          ? <div className="card" style={{ margin: 0 }}><SopText text={v.body} /></div>
          : <textarea rows={6} maxLength={4000} value={v.body} onChange={e => set('body', e.target.value)}
            placeholder={'**Bold**, - bullet, 1. numbered step, ! important line, links work.'} />}
      </div>

      <div className="field"><label>Who it is for</label>
        <div className="row text-sm" style={{ gap: 10, flexWrap: 'wrap' }}>
          {everyone && <span className="text-muted">{v.teams.length ? '' : 'Everyone (no team ticked)'}</span>}
          {teamChoices.map(t => (
            <label key={t} className="row" style={{ gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={v.teams.includes(t)}
                onChange={() => set('teams', v.teams.includes(t) ? v.teams.filter(x => x !== t) : [...v.teams, t])} /> {t}
            </label>
          ))}
        </div>
        {!everyone && <span className="text-sm text-muted">You can post to your own team. Notices for everyone need “Post Announcements”.</span>}
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 150px' }}><label>Show from</label>
          <input type="date" value={v.show_from} onChange={e => set('show_from', e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}><label>Until (optional)</label>
          <input type="date" value={v.show_until} min={v.show_from} onChange={e => set('show_until', e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 200px' }}><label>About a client (optional)</label>
          <select value={v.client_id ?? ''} onChange={e => set('client_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="row text-sm" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={v.pinned} onChange={e => set('pinned', e.target.checked)} /> 📌 Pin to the top
        </label>
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={v.must_read} onChange={e => set('must_read', e.target.checked)} /> Must read (people confirm “✓ I've read this”)
        </label>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 220px' }}><label>Link an SOP (optional)</label>
          <select value={v.sop_id ?? ''} onChange={e => set('sop_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {ctx.sops.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 220px' }}><label>Link a payer (optional)</label>
          {payer
            ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set('payer_id', null)}>✕</button></div>
            : <PayerSearch payers={ctx.payers} onSelect={p => set('payer_id', p.id)} />}
        </div>
        {updates.length > 0 && (
          <div className="field" style={{ flex: '1 1 220px' }}><label>Link a payer update (optional)</label>
            <select value={v.payer_update_id ?? ''} onChange={e => set('payer_update_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {updates.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient or claim details on the board.</p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save' : 'Post notice'}</button>
      </div>
    </Modal>
  );
}
