import { useState } from 'react';
import { PROVIDER_TYPES, CHECKLIST_REQUESTS, buildEnrollmentChecklist } from '../../lib/credentialing';
import CopyButton from '../../components/shared/CopyButton';
import PayerSearch from '../../components/shared/PayerSearch';

const SOURCE_ICONS = { payer: '📇', sop: '📚', denial: '🧩', updates: '📰' };
const LOOKUP_LABELS = {
  search_payers: 'Payer Directory', get_payer: 'payer card', search_sops: 'SOP Library', get_sop: 'SOP',
  search_payer_updates: 'Payer Updates', get_auth_rules: 'payer rules', list_clients: 'client list',
};

/**
 * ✨ Enrollment checklist (roadmap 9.3): payer + provider type + request → documents, how to submit, timeline,
 * follow-up and steps from Helix Hub data (Provider Relations contacts, notes, credentialing SOPs, payer updates).
 * Only these selections are sent — never provider names or NPIs.
 */
export default function CredChecklist({ knowledge, user, onOpenSource }) {
  const [payer, setPayer] = useState(null);
  const [providerType, setProviderType] = useState('agency');
  const [request, setRequest] = useState('new');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function build() {
    if (!payer) return setError('Choose the payer.');
    setError(''); setResult(null); setBusy('Thinking…');
    try {
      setResult(await buildEnrollmentChecklist({ payer, providerType, request }, knowledge, user,
        name => setBusy(`Looking in the ${LOOKUP_LABELS[name] ?? 'records'}…`)));
    } catch (e) {
      setError(e.message === 'NO_KEY' ? 'No AI key is saved in Settings — an admin can add one.' : e.message);
    }
    setBusy('');
  }

  const c = result?.checklist;
  const text = c && [
    `Enrollment checklist — ${payer.name} · ${PROVIDER_TYPES.find(t => t.value === providerType)?.label} · ${CHECKLIST_REQUESTS.find(r => r.value === request)?.label}`,
    c.documents.length && `Documents: ${c.documents.join('; ')}`, c.how_to_submit && `Submit: ${c.how_to_submit}`,
    c.timeline && `Timeline: ${c.timeline}`, c.steps.length && `Steps:\n${c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    c.follow_up && `Follow-up: ${c.follow_up}`,
  ].filter(Boolean).join('\n');
  const section = (title, items) => items?.length > 0 && (
    <div style={{ marginTop: 8 }}>
      <div className="bold text-sm">{title}</div>
      <ul style={{ margin: '2px 0 0', paddingLeft: 20 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 240px' }}><label>Payer</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => setPayer(null)}>✕</button></div>
              : <PayerSearch payers={knowledge.payers} onSelect={setPayer} />}
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}><label>Provider type</label>
            <select value={providerType} onChange={e => setProviderType(e.target.value)}>
              {PROVIDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 220px' }}><label>Request</label>
            <select value={request} onChange={e => setRequest(e.target.value)}>
              {CHECKLIST_REQUESTS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="field"><button className="btn-primary" onClick={build} disabled={!!busy || !payer}>✨ Build checklist</button></div>
        </div>
        <p className="text-sm text-muted" style={{ margin: 0 }}>🔒 Only the payer, provider type and request are sent — never provider names or NPIs.</p>
      </div>
      {busy && <div className="card mb-16 text-sm text-muted">⏳ {busy}</div>}
      {error && <div className="card mb-16 text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}
      {c && (
        <div className="card mb-16">
          {section('Documents to gather', c.documents)}
          {c.how_to_submit && <div style={{ marginTop: 8 }}><span className="bold text-sm">How to submit:</span> {c.how_to_submit}</div>}
          {c.timeline && <div style={{ marginTop: 6 }}><span className="bold text-sm">Timeline:</span> {c.timeline}</div>}
          {c.steps.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="bold text-sm">Steps</div>
              <ol style={{ margin: '2px 0 0', paddingLeft: 20 }}>{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
          {c.follow_up && <div style={{ marginTop: 6 }}><span className="bold text-sm">Follow-up:</span> {c.follow_up}</div>}
          {section('⚠ Watch out', c.watch_out)}
          {section('Missing in Helix Hub', c.missing)}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            {result.sources.map(s => (
              <button key={`${s.kind}:${s.id}`} className="btn-sm" onClick={() => onOpenSource(s)}>{SOURCE_ICONS[s.kind]} {s.label}</button>
            ))}
            <span style={{ marginLeft: 'auto' }}><CopyButton value={text} label="📋 Copy checklist" /></span>
          </div>
        </div>
      )}
    </>
  );
}
