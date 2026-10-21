import { useState, useEffect } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadDenialCodes } from '../../lib/denials';
import { canViewReports } from '../../lib/reports';
import DenialTrends from './DenialTrends';
import WeeklyClientReport from './WeeklyClientReport';

/**
 * 📈 Reports (roadmap 10.2): 🧩 Denial trends and 🗓 Weekly client report. Read-only, for “View reports” holders
 * (admin / manager / supervisor by default). Exports carry counts and names only.
 */
export default function Reports({ user }) {
  const allowed = canViewReports(user);
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [codes, setCodes] = useState([]);
  const [tab, setTab] = useState('denials');

  useEffect(() => {
    let alive = true;
    if (!allowed) return undefined;
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadDenialCodes().then(c => { if (alive) setCodes(c ?? []); });
    return () => { alive = false; };
  }, [allowed]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">📈 Reports</div>
          <div className="page-subtitle">Denial trends by payer and client, and a weekly report for each client.</div>
        </div>
      </div>
      {!allowed ? (
        <div className="card text-muted">Reports are available to managers and supervisors, or anyone an admin gives “View reports”.</div>
      ) : (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['denials', '🧩 Denial trends'], ['weekly', '🗓 Weekly client report']].map(([id, label]) => (
              <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'denials' && <DenialTrends ctx={ctx} codes={codes} user={user} />}
          {tab === 'weekly' && <WeeklyClientReport ctx={ctx} user={user} />}
        </>
      )}
    </div>
  );
}
