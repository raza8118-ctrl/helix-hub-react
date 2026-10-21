import { useState } from 'react';
import { loadWorkedClaims, pickSample, queueSample } from '../../lib/qa';
import { TEAMS } from '../../lib/constants';
import { addDays, today } from '../../lib/helpers';

/**
 * 🎲 Sampling (roadmap 7.1): randomly picks claims people worked in the Smart Worklist and puts them in the audit
 * queue with a scorecard. Only claims not already picked are used; the list is never saved until “Add to audit queue”.
 */
export default function QaSampling({ user, setup, people, onQueued }) {
  const [who, setWho] = useState('ALL');               // 'ALL' | 'team:<name>' | emp_id
  const [from, setFrom] = useState(addDays(today(), -7));
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState('count');
  const [n, setN] = useState(5);
  const [cardId, setCardId] = useState('');
  const [picks, setPicks] = useState(null);
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cards = setup.scorecards.filter(c => c.active !== false);
  const teams = TEAMS.filter(t => people.some(p => p.team === t));
  const chosen = who === 'ALL' ? people : who.startsWith('team:') ? people.filter(p => p.team === who.slice(5)) : people.filter(p => p.emp_id === who);
  const nameOf = id => people.find(p => p.emp_id === id)?.name ?? id;

  async function pick() {
    setError(''); setPicks(null);
    if (!(Number(n) > 0)) return setError('Type how many claims (or what %).');
    if (from > to) return setError('The start date is after the end date.');
    setBusy(true);
    const claims = await loadWorkedClaims(chosen.map(p => p.emp_id), from, to);
    setBusy(false);
    if (claims == null) return setError('The Smart Worklist isn’t set up yet — sampling needs it. Use “+ New audit” instead.');
    setFound(claims.length);
    setPicks(pickSample(claims, mode, Number(n)));
  }

  async function queue() {
    if (!cardId) return setError('Choose the scorecard to audit them with.');
    setBusy(true);
    const added = await queueSample(picks, Number(cardId), user);
    setBusy(false);
    if (!added) return setError('Could not add them. Please try again.');
    onQueued();
  }

  const perPerson = {};
  (picks ?? []).forEach(p => { perPerson[p.worked_by] = (perPerson[p.worked_by] ?? 0) + 1; });

  return (
    <div className="card mb-16">
      <div className="card-header"><div className="card-title">🎲 Pick a sample of worked claims</div></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label>Whose work</label>
          <select value={who} onChange={e => { setWho(e.target.value); setPicks(null); }}>
            <option value="ALL">Everyone I can audit ({people.length})</option>
            {teams.map(t => <option key={t} value={`team:${t}`}>Team: {t}</option>)}
            {people.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}><label>Worked from</label>
          <input type="date" value={from} max={today()} onChange={e => { setFrom(e.target.value); setPicks(null); }} />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}><label>to</label>
          <input type="date" value={to} max={today()} onChange={e => { setTo(e.target.value); setPicks(null); }} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '0 1 200px' }}><label>How many per person</label>
          <div className="row" style={{ gap: 4 }}>
            <input type="number" min="1" style={{ width: 80 }} value={n} onChange={e => { setN(e.target.value); setPicks(null); }} />
            <select value={mode} onChange={e => { setMode(e.target.value); setPicks(null); }}>
              <option value="count">claims</option>
              <option value="percent">% of their claims</option>
            </select>
          </div>
        </div>
        <div className="field"><button className="btn-primary" onClick={pick} disabled={busy || !chosen.length}>{busy ? 'Looking…' : 'Pick sample'}</button></div>
      </div>

      {picks && (
        <div style={{ marginTop: 8 }}>
          <p className="text-sm">{found} worked claims found (not audited yet) → <b>{picks.length}</b> picked at random.</p>
          {picks.length > 0 && (
            <>
              <div className="row text-sm" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {Object.entries(perPerson).map(([id, c]) => <span key={id} className="badge badge-gray">{nameOf(id)}: {c}</span>)}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}><label>Audit them with</label>
                  <select value={cardId} onChange={e => setCardId(e.target.value)}>
                    <option value="">— Choose scorecard —</option>
                    {cards.map(c => <option key={c.id} value={c.id}>{c.name}{c.team ? ` (${c.team})` : ''}</option>)}
                  </select>
                </div>
                <button className="btn-sm" onClick={pick} disabled={busy}>↻ Pick again</button>
                <button className="btn-primary" onClick={queue} disabled={busy}>Add {picks.length} to audit queue</button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <p className="text-sm text-muted" style={{ marginBottom: 0 }}>
        Claims come from the 📋 Smart Worklist (any worked status). For other work, use “+ New audit” on the 🔍 Audit tab.
      </p>
    </div>
  );
}
