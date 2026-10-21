import { useState, useEffect } from 'react';
import { db } from '../../lib/supabase';
import { REQUEST_TYPES, NEEDED, buildChecklist, checklistText, addAuthFollowup } from '../../lib/authAssistant';
import { AUTH_SERVICES } from '../../lib/payerOptions';
import CopyButton from '../../components/shared/CopyButton';
import PayerSearch from '../../components/shared/PayerSearch';

const SOURCE_ICONS = { payer: '📇', sop: '📚', denial: '🧩', updates: '📰' };
const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * 🔐 Auth checklist (roadmap 9.2): client + payer + plan + service + request type → a sourced checklist from Helix Hub
 * data (auth rules, auth contact, auth SOP, authorization payer updates). No patient fields and no dates are asked for.
 */
export default function AuthChecklist({ knowledge, user, lookupLabels, onOpenSource, initialPayerId = null, initialService = '' }) {
  const [clientId, setClientId] = useState('');
  const [payer, setPayer] = useState(() => knowledge.payers.find(p => p.id === initialPayerId) ?? null);   // Ask Helix 📍 button
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('');
  const [service, setService] = useState(initialService || 'hh_soc');
  const [requestType, setRequestType] = useState('initial');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);           // { checklist, sources, req }
  const [error, setError] = useState('');
  const [followup, setFollowup] = useState('');

  const payerId = payer?.id;
  useEffect(() => {
    let alive = true;
    if (!payerId) return undefined;
    db('payer_plans').select('id,plan_name,active').eq('payer_id', payerId)
      .then(({ data }) => { if (alive) setPlans((data ?? []).filter(p => p.active !== false)); });
    return () => { alive = false; };
  }, [payerId]);

  function pickPayer(p) { setPayer(p); setPlans([]); setPlanId(''); setResult(null); }

  async function build() {
    if (!payer) return setError('Choose the payer.');
    setError(''); setResult(null); setFollowup('');
    const req = {
      client: knowledge.clients.find(c => String(c.id) === clientId) ?? null, payer,
      planName: plans.find(p => String(p.id) === planId)?.plan_name ?? '', service, requestType,
    };
    setBusy('Thinking…');
    try {
      const r = await buildChecklist(req, knowledge, user, name => setBusy(`Looking in the ${lookupLabels[name] ?? 'records'}…`));
      setResult({ ...r, req });
    } catch (e) {
      setError(e.message === 'NO_KEY' ? 'No AI key is saved in Settings — an admin can add one. Meanwhile check 🔐 Authorization rules on the payer card.' : e.message);
    }
    setBusy('');
  }

  async function remind() {
    const due = await addAuthFollowup(result.req, result.checklist.decision_days, user);
    setFollowup(due ? `⏰ Reminder set for ${fmtDate(due)} — it shows in Smart Worklist → Follow-ups.` : 'Could not add the reminder (the follow-up database update may not be run yet).');
  }

  const c = result?.checklist;
  const section = (title, items) => items?.length > 0 && (
    <div style={{ marginTop: 8 }}>
      <div className="bold text-sm">{title}</div>
      <ul style={{ margin: '2px 0 0', paddingLeft: 20 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 240px' }}><label>Payer</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => pickPayer(null)}>✕</button></div>
              : <PayerSearch payers={knowledge.payers} onSelect={pickPayer} />}
          </div>
          {plans.length > 0 && (
            <div className="field" style={{ flex: '1 1 200px' }}><label>Plan (optional)</label>
              <select value={planId} onChange={e => setPlanId(e.target.value)}>
                <option value="">Any / not sure</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.plan_name}</option>)}
              </select>
            </div>
          )}
          <div className="field" style={{ flex: '1 1 200px' }}><label>Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">— Not set —</option>
              {knowledge.clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 220px' }}><label>Service</label>
            <select value={service} onChange={e => setService(e.target.value)}>
              {AUTH_SERVICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 220px' }}><label>Request</label>
            <select value={requestType} onChange={e => setRequestType(e.target.value)}>
              {REQUEST_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="field"><button className="btn-primary" onClick={build} disabled={!!busy || !payer}>✨ Build checklist</button></div>
        </div>
        <p className="text-sm text-muted" style={{ margin: 0 }}>🔒 No patient details are asked for — only the payer, client, service and request type are sent.</p>
      </div>

      {busy && <div className="card mb-16 text-sm text-muted">⏳ {busy}</div>}
      {error && <div className="card mb-16 text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}

      {c && (
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${NEEDED[c.auth_needed]?.badge ?? 'badge-gray'}`} style={{ fontSize: 14 }}>{NEEDED[c.auth_needed]?.label ?? c.auth_needed}</span>
            {c.auth_needed_detail && <span>{c.auth_needed_detail}</span>}
          </div>
          {(c.submit_method || c.submit_details) && (
            <div style={{ marginTop: 8 }}><span className="bold text-sm">How to submit:</span> {c.submit_method}{c.submit_details ? ` — ${c.submit_details}` : ''}</div>
          )}
          <div className="row text-sm" style={{ gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
            <span><span className="text-muted">Decision usually in:</span> {c.decision_days ? `${c.decision_days} working days` : 'not recorded'}</span>
            <span><span className="text-muted">Valid for:</span> {c.valid_days ? `${c.valid_days} days` : 'not recorded'}</span>
            {c.retro && <span><span className="text-muted">Retro:</span> {c.retro}</span>}
          </div>
          {section('Documents to gather', c.documents)}
          {c.steps?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="bold text-sm">Steps</div>
              <ol style={{ margin: '2px 0 0', paddingLeft: 20 }}>{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
          {section('⚠ Watch out', c.watch_out)}
          {section('Missing in Helix Hub', c.missing)}

          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            {result.sources.map(s => (
              <button key={`${s.kind}:${s.id}`} className="btn-sm" onClick={() => onOpenSource(s)} title="Open the source">{SOURCE_ICONS[s.kind]} {s.label}</button>
            ))}
            <span className="row" style={{ gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <CopyButton value={checklistText(c, result.req)} label="📋 Copy checklist" />
              {c.claim_note && <CopyButton value={c.claim_note} label="📝 Copy claim note" />}
              <button className="btn-sm" onClick={remind} disabled={!!followup}>⏰ Add follow-up</button>
            </span>
          </div>
          {c.claim_note && <div className="text-sm text-muted" style={{ marginTop: 6 }}>Claim note: {c.claim_note}</div>}
          {followup && <div className="text-sm" style={{ marginTop: 6 }}>{followup}</div>}
        </div>
      )}
    </>
  );
}
