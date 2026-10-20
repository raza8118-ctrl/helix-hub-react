import { useState } from 'react';
import DeadlineHelper from './DeadlineHelper';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * ⏰ Filing & appeal deadlines (roadmap 6.2): the 4.4 Deadline helper with its own client / payer pickers.
 * Medicare standard limits and days typed by hand work without a payer.
 */
export default function DeadlineTool({ ctx }) {
  const [clientId, setClientId] = useState('');
  const [payer, setPayer] = useState(null);
  const client = ctx.clients.find(c => String(c.id) === clientId) ?? null;

  return (
    <div>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ maxWidth: 240 }} aria-label="Client">
            <option value="">Any client</option>
            {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
          {payer
            ? <span className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">Payer: {payer.name}</span>
                <button className="btn-sm" title="Clear payer" onClick={() => setPayer(null)}>✕</button></span>
            : <div style={{ flex: '1 1 240px', minWidth: 0 }}><PayerSearch payers={ctx.payers} onSelect={setPayer} placeholder="Payer (optional) — name or alias" /></div>}
        </div>
      </div>
      <DeadlineHelper payer={payer} client={client} open onToggle={() => {}} />
    </div>
  );
}
