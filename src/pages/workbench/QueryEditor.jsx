import { useState } from 'react';
import { QUERY_CATEGORIES, ASKED_VIA, CHASE_EVERY_WORKDAYS, addWorkdays, checkQuery, addQuery, editQuery, canManageQueries } from '../../lib/clientQueries';
import { TEAMS } from '../../lib/constants';
import { today } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/** New / edit client query (roadmap 7.3). Minimum fields; the question is checked for patient details. */
export default function QueryEditor({ row, ctx, people, user, onClose, onSaved }) {
  const [q, setQ] = useState(() => ({
    client_id: row?.client_id ?? null, team: row?.team ?? (TEAMS.includes(user.team) ? user.team : ''),
    category: row?.category ?? 'documentation', priority: row?.priority ?? 'normal', payer_id: row?.payer_id ?? null,
    claim_number: row?.claim_number ?? '', question: row?.question ?? '', asked_via: row?.asked_via ?? 'email',
    asked_on: row?.asked_on ?? today(), expected_on: row?.expected_on ?? addWorkdays(today(), CHASE_EVERY_WORKDAYS),
    contact_name: row?.contact_name ?? '', owner_emp_id: row?.owner_emp_id ?? user.emp_id,
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setQ(s => ({ ...s, [k]: v }));
  const payer = q.payer_id ? ctx.payers.find(p => p.id === q.payer_id) : null;
  // Owner: me, or anyone when I can manage queries (reassigning an existing query is a separate action)
  const owners = canManageQueries(user) ? people : people.filter(p => p.emp_id === user.emp_id);

  async function save() {
    const problem = checkQuery(q);
    if (problem) return setError(problem);
    setSaving(true);
    const ok = row ? await editQuery(row, q, user) : await addQuery(q, user);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved(ok);
  }

  return (
    <Modal title={row ? 'Edit client query' : 'New client query'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 200px' }}><label>Client</label>
            <select value={q.client_id ?? ''} onChange={e => set('client_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Choose —</option>
              {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 150px' }}><label>Team</label>
            <select value={q.team} onChange={e => set('team', e.target.value)}>
              <option value="">—</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}><label>About</label>
            <select value={q.category} onChange={e => set('category', e.target.value)}>
              {QUERY_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Priority</label>
            <select value={q.priority} onChange={e => set('priority', e.target.value)}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>
        <div className="field"><label>Question</label>
          <textarea rows={3} maxLength={1500} value={q.question} onChange={e => set('question', e.target.value)}
            placeholder="e.g. Please send the signed plan of care for the SOC visit so we can bill the first period." />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}><label>Payer (optional)</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set('payer_id', null)}>✕</button></div>
              : <PayerSearch payers={ctx.payers} onSelect={p => set('payer_id', p.id)} />}
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}><label>Claim # (optional)</label>
            <input type="text" value={q.claim_number} onChange={e => set('claim_number', e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Asked via</label>
            <select value={q.asked_via} onChange={e => set('asked_via', e.target.value)}>
              {ASKED_VIA.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Asked on</label>
            <input type="date" value={q.asked_on} max={today()} onChange={e => set('asked_on', e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Answer expected by</label>
            <input type="date" value={q.expected_on ?? ''} min={q.asked_on} onChange={e => set('expected_on', e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}><label>Client contact (optional)</label>
            <input type="text" value={q.contact_name} maxLength={80} onChange={e => set('contact_name', e.target.value)} placeholder="Agency staff member we asked" />
          </div>
          {!row && (
            <div className="field" style={{ flex: '1 1 200px' }}><label>Follow-up owner</label>
              <select value={q.owner_emp_id} onChange={e => set('owner_emp_id', e.target.value)}>
                {owners.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient names, dates of birth, member IDs or dates in the question — use the claim # field. The claim # is wiped 90 days after the query is closed.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save' : 'Log query'}</button>
        </div>
      </div>
    </Modal>
  );
}
