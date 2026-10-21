import { useState, useEffect } from 'react';
import { NOTE_FIELDS, itemStatusOf, isEditable, checkHandover, loadMyHandover, saveHandover } from '../../lib/handover';
import { today, yesterday } from '../../lib/helpers';
import PayerSearch from '../../components/shared/PayerSearch';

const blankItem = () => ({ key: Math.random().toString(36).slice(2), client_id: null, payer_id: null, claim_number: '', what: '', priority: 'normal', status: 'open' });

/** 📝 My handover (roadmap 7.4): one per shift date — notes + carry-over items; draft or submit to the team. */
export default function HandoverForm({ user, ctx, names, onSaved }) {
  const [date, setDate] = useState(today());
  const [loaded, setLoaded] = useState(null);           // { date, handover, items } from the database
  const [h, setH] = useState({});
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);

  const empId = user.emp_id;
  useEffect(() => {
    let alive = true;
    loadMyHandover(empId, date).then(r => {
      if (!alive) return;
      setLoaded({ date, ...r });
      setH(r.handover ?? { shift_date: date });
      setItems(r.items.map(i => ({ ...i, key: `i${i.id}`, claim_number: i.claim_number ?? '' })));
      setError(''); setSaved('');
    });
    return () => { alive = false; };
  }, [empId, date]);

  if (!loaded || loaded.date !== date) return <div className="card text-muted">Loading…</div>;
  const editable = isEditable(loaded.handover ?? { shift_date: date });
  const submitted = h.status === 'submitted';
  const setItem = (key, patch) => setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)));

  async function save(submit) {
    const problem = checkHandover(h, items);
    if (problem) return setError(problem);
    setSaving(true);
    const row = await saveHandover({ ...h, shift_date: date }, items, loaded.items, user, { submit });
    setSaving(false);
    if (!row) return setError('Could not save. Please try again.');
    const fresh = await loadMyHandover(empId, date);
    setLoaded({ date, ...fresh });
    setH(fresh.handover);
    setItems(fresh.items.map(i => ({ ...i, key: `i${i.id}`, claim_number: i.claim_number ?? '' })));
    setError('');
    setSaved(submit || submitted ? 'Saved — your team can see it.' : 'Draft saved — only you can see it until you submit.');
    onSaved();
  }

  return (
    <div className="card mb-16">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title">📝 My handover</div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <select value={date} onChange={e => setDate(e.target.value)} aria-label="Shift date">
            <option value={today()}>Today’s shift</option>
            <option value={yesterday()}>Yesterday’s shift</option>
          </select>
          {submitted ? <span className="badge badge-green">Submitted</span> : loaded.handover ? <span className="badge badge-yellow">Draft</span> : null}
        </div>
      </div>
      {!user.team && <p className="text-sm text-muted" style={{ marginTop: 0 }}>Tip: you have no team set on the Team page, so only managers will see your handover.</p>}

      {NOTE_FIELDS.map(f => (
        <div key={f.key} className="field"><label>{f.label}</label>
          <textarea rows={2} maxLength={1500} value={h[f.key] ?? ''} disabled={!editable} placeholder={f.hint}
            onChange={e => setH(x => ({ ...x, [f.key]: e.target.value }))} />
        </div>
      ))}

      <div className="field"><label>Carry over — what the next shift should pick up</label>
        {items.length === 0 && <div className="text-sm text-muted">Nothing carried over.</div>}
        {items.map((it, i) => {
          const locked = !editable || (it.status && it.status !== 'open');
          const payer = it.payer_id ? ctx.payers.find(p => p.id === it.payer_id) : null;
          return (
            <div key={it.key} style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="text-sm bold">{i + 1}.</span>
                <input type="text" style={{ flex: '3 1 260px' }} value={it.what} disabled={locked} maxLength={500}
                  placeholder="What is left to do" onChange={e => setItem(it.key, { what: e.target.value })} />
                <select value={it.priority} disabled={locked} onChange={e => setItem(it.key, { priority: e.target.value })} aria-label="Priority">
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
                {it.id && it.status !== 'open' && (
                  <span className={`badge ${itemStatusOf(it.status).badge}`}>{itemStatusOf(it.status).label}{it.picked_by ? ` · ${names[it.picked_by] ?? it.picked_by}` : ''}</span>
                )}
                {!locked && <button type="button" className="btn-sm" onClick={() => setItems(list => list.filter(x => x.key !== it.key))} aria-label="Remove item">✕</button>}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4, paddingLeft: 18 }}>
                <select value={it.client_id ?? ''} disabled={locked} onChange={e => setItem(it.key, { client_id: e.target.value ? Number(e.target.value) : null })} aria-label="Client">
                  <option value="">Client (optional)</option>
                  {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ flex: '1 1 200px' }}>
                  {payer
                    ? <span className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span>{!locked && <button type="button" className="btn-sm" onClick={() => setItem(it.key, { payer_id: null })}>✕</button>}</span>
                    : !locked && <PayerSearch payers={ctx.payers} onSelect={p => setItem(it.key, { payer_id: p.id })} placeholder="Payer (optional)" />}
                </div>
                <input type="text" style={{ flex: '0 1 160px' }} value={it.claim_number} disabled={locked} placeholder="Claim # (optional)"
                  onChange={e => setItem(it.key, { claim_number: e.target.value })} />
              </div>
            </div>
          );
        })}
        {editable && <button type="button" className="btn-sm" style={{ marginTop: 6 }} onClick={() => setItems(list => [...list, blankItem()])}>+ Carry-over item</button>}
      </div>

      <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient names, dates of birth, member IDs or dates — use the claim # field.</p>
      {!editable && <p className="text-sm text-muted">This handover can no longer be changed.</p>}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {saved && <p className="text-sm" style={{ color: 'var(--success, green)' }}>{saved}</p>}
      {editable && (
        <div className="form-actions">
          {!submitted && <button className="btn-sm" onClick={() => save(false)} disabled={saving}>Save draft</button>}
          <button className="btn-primary" onClick={() => save(true)} disabled={saving}>{saving ? 'Saving…' : submitted ? 'Save changes' : 'Submit handover'}</button>
        </div>
      )}
    </div>
  );
}
