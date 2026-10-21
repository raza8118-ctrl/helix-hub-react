import { useState, useMemo } from 'react';
import { RESULTS, DEFAULT_PASS_MARK, newResults, scoreOf, commentProblem, saveAudit } from '../../lib/qa';
import { today } from '../../lib/helpers';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * One QA audit (roadmap 7.1): the agent's claim checked against a scorecard. Each failed checkpoint gets an error
 * category and the SOP that explains it. Saved as a draft or sent to the agent. Minimum claim fields only.
 */
export default function QaAuditForm({ audit, setup, ctx, people, user, onClose, onSaved }) {
  const cards = setup.scorecards.filter(c => c.active !== false || c.id === audit.scorecard_id);
  const pointsOf = cardId => setup.checkpoints.filter(c => c.scorecard_id === cardId && c.active !== false);
  const [form, setForm] = useState(() => ({
    id: audit.id ?? null, status: audit.status ?? null,
    agent_emp_id: audit.agent_emp_id ?? '', scorecard_id: audit.scorecard_id ?? null,
    client_id: audit.client_id ?? null, payer_id: audit.payer_id ?? null, claim_number: audit.claim_number ?? '',
    work_date: audit.work_date ?? today(), comment: audit.comment ?? '',
    results: audit.results?.length ? audit.results : audit.scorecard_id ? newResults(pointsOf(audit.scorecard_id)) : [],
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setResult = (i, patch) => setForm(f => ({ ...f, results: f.results.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const card = cards.find(c => c.id === form.scorecard_id);
  const passMark = Number(card?.pass_mark ?? DEFAULT_PASS_MARK);
  const { score, passed, fatal } = scoreOf(form.results, passMark);
  const sops = useMemo(() => ctx.sops.filter(s => s.active !== false), [ctx.sops]);
  const categories = setup.categories.filter(c => c.active !== false);
  const payer = form.payer_id ? ctx.payers.find(p => p.id === form.payer_id) : null;
  const agent = people.find(p => p.emp_id === form.agent_emp_id);

  function pickAgent(id) {
    const p = people.find(x => x.emp_id === id);
    setForm(f => {
      // Suggest the scorecard made for the agent's team when none is chosen yet
      const suggested = !f.scorecard_id && p?.team ? cards.find(c => c.team === p.team && c.active !== false) : null;
      return suggested ? { ...f, agent_emp_id: id, scorecard_id: suggested.id, results: newResults(pointsOf(suggested.id)) } : { ...f, agent_emp_id: id };
    });
  }
  function pickCard(id) {
    const cardId = id ? Number(id) : null;
    setForm(f => ({ ...f, scorecard_id: cardId, results: cardId ? newResults(pointsOf(cardId)) : [] }));
  }

  async function save(send) {
    if (!form.agent_emp_id) return setError('Choose whose work you audited.');
    if (form.agent_emp_id === user.emp_id) return setError('You can’t audit your own work.');
    if (!form.scorecard_id || !form.results.length) return setError('Choose a scorecard with checkpoints.');
    if (send && score == null) return setError('Mark at least one checkpoint Pass or Fail.');
    if (send && form.results.some(r => r.result === 'fail' && !r.category_id)) return setError('Pick an error category for every failed checkpoint.');
    const typed = [form.comment, ...form.results.map(r => r.comment)].filter(Boolean);
    for (const t of typed) { const p = commentProblem(t); if (p) return setError(p); }
    setSaving(true);
    const saved = await saveAudit(form, card, user, { send });
    setSaving(false);
    if (!saved) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <div className="card mb-16">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title">{form.id ? 'QA audit' : 'New QA audit'}{agent ? ` — ${agent.name}` : ''}</div>
        <button className="btn-sm" onClick={onClose}>← Back</button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label>Agent (whose work)</label>
          <select value={form.agent_emp_id} onChange={e => pickAgent(e.target.value)}>
            <option value="">— Choose —</option>
            {people.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name}{p.team ? ` (${p.team})` : ''}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 200px' }}><label>Scorecard</label>
          <select value={form.scorecard_id ?? ''} onChange={e => pickCard(e.target.value)}>
            <option value="">— Choose —</option>
            {cards.map(c => <option key={c.id} value={c.id}>{c.name}{c.team ? ` (${c.team})` : ''}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}><label>Work date</label>
          <input type="date" value={form.work_date ?? ''} max={today()} onChange={e => set('work_date', e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label>Client</label>
          <select value={form.client_id ?? ''} onChange={e => set('client_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Not set —</option>
            {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 200px' }}><label>Payer</label>
          {payer
            ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set('payer_id', null)}>✕</button></div>
            : <PayerSearch payers={ctx.payers} onSelect={p => set('payer_id', p.id)} />}
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}><label>Claim # (optional)</label>
          <input type="text" value={form.claim_number} onChange={e => set('claim_number', e.target.value)} />
        </div>
      </div>

      {form.results.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {form.results.map((r, i) => (
            <div key={r.checkpoint_id ?? i} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 260px' }}>
                  <span>{i + 1}. {r.text}</span>
                  <span className="text-sm text-muted"> · weight {r.weight}</span>
                  {r.critical && <span className="badge badge-red" style={{ marginLeft: 6 }}>Critical</span>}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {RESULTS.map(o => (
                    <button key={o.value} type="button" className={r.result === o.value ? 'btn-primary btn-sm' : 'btn-sm'}
                      aria-pressed={r.result === o.value} onClick={() => setResult(i, { result: o.value })}>{o.label}</button>
                  ))}
                </div>
              </div>
              {r.result === 'fail' && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6, paddingLeft: 16 }}>
                  <div className="field" style={{ flex: '1 1 180px', marginBottom: 0 }}><label>Error category</label>
                    <select value={r.category_id ?? ''} onChange={e => setResult(i, { category_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">— Choose —</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: '1 1 180px', marginBottom: 0 }}><label>SOP to read</label>
                    <select value={r.sop_id ?? ''} onChange={e => setResult(i, { sop_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">— None —</option>
                      {sops.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: '2 1 240px', marginBottom: 0 }}><label>What to do next time (optional)</label>
                    <input type="text" value={r.comment ?? ''} maxLength={300} onChange={e => setResult(i, { comment: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="field" style={{ marginTop: 8 }}><label>Overall comment (optional)</label>
        <textarea rows={2} maxLength={600} value={form.comment} onChange={e => set('comment', e.target.value)} />
      </div>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient names, dates of birth, member IDs or other claim details in comments. The claim # is wiped 90 days after the audit is closed.</p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="bold" style={{ fontSize: 18 }}>
          Score: {score == null ? '—' : `${score}%`}
        </span>
        {score != null && (fatal
          ? <span className="badge badge-red">Critical error — score 0</span>
          : <span className={`badge ${passed ? 'badge-green' : 'badge-red'}`}>{passed ? 'Pass' : 'Below'} {passMark}%</span>)}
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-sm" onClick={() => save(false)} disabled={saving}>Save draft</button>
        <button className="btn-primary" onClick={() => save(true)} disabled={saving}>{saving ? 'Saving…' : 'Send to agent'}</button>
      </div>
    </div>
  );
}
