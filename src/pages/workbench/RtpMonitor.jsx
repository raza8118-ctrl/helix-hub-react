import { useState, useMemo } from 'react';
import { RTP_AGE_BUCKETS, isDone, rtpAge, rtpBucket, canManageMedicare } from '../../lib/medicareTrackers';
import { alertDialog } from '../../components/shared/Dialog';
import MedicareTrackerList from './MedicareTrackerList';
import RtpUpload from './RtpUpload';

const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left' };
const fmtTime = d => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * 🔁 RTP / suspense monitor (roadmap 7.5): claims sitting in FISS RTP (T B9997) or suspense, from uploads or added by
 * hand; age in status per client, top reason codes, new / cleared since the last upload. Uploading = “Manage Medicare
 * trackers”.
 */
export default function RtpMonitor({ items, uploads, ctx, people, names, user, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const clientName = id => ctx.clients.find(c => c.id === id)?.name ?? '—';
  const latest = useMemo(() => {
    const by = {};
    for (const u of uploads) if (!by[u.client_id]) by[u.client_id] = u;   // uploads are newest first
    return by;
  }, [uploads]);

  const open = items.filter(i => !isDone('rtp', i));
  const byClient = useMemo(() => {
    const by = {};
    for (const i of items) {
      if (isDone('rtp', i)) continue;
      const r = (by[i.client_id] ??= { client_id: i.client_id, total: 0, buckets: Object.fromEntries(RTP_AGE_BUCKETS.map(b => [b.key, 0])) });
      r.total += 1;
      r.buckets[rtpBucket(rtpAge(i))] += 1;
    }
    return Object.values(by).sort((a, b) => b.total - a.total);
  }, [items]);
  const reasons = useMemo(() => {
    const c = {};
    for (const i of items) if (!isDone('rtp', i) && i.reason_code) c[i.reason_code] = (c[i.reason_code] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [items]);
  const isNew = i => !isDone('rtp', i) && i.first_seen_upload && latest[i.client_id]?.id === i.first_seen_upload;

  const badges = i => (
    <>
      {i.location && <span className="badge badge-gray">{i.location}</span>}
      {i.reason_code && <span className="text-sm text-muted">reason {i.reason_code}</span>}
      {!isDone('rtp', i) && <span className={`badge ${rtpAge(i) > 14 ? 'badge-red' : rtpAge(i) > 7 ? 'badge-yellow' : 'badge-gray'}`}>{rtpAge(i)}d in status</span>}
      {isNew(i) && <span className="badge badge-blue">New on last upload</span>}
    </>
  );

  return (
    <>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="card mb-16" style={{ flex: '2 1 420px' }}>
          <div className="card-header"><div className="card-title">⏳ Open RTP / suspense by age in status <span className="text-sm text-muted">· {open.length}</span></div></div>
          {byClient.length === 0 ? <div className="text-sm text-muted">Nothing open.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Client', 'Open', ...RTP_AGE_BUCKETS.map(b => b.label), 'Last upload'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
                <tbody>
                  {byClient.map(r => (
                    <tr key={r.client_id ?? 'none'}>
                      <td style={cell}>{clientName(r.client_id)}</td>
                      <td style={cell} className="bold">{r.total}</td>
                      {RTP_AGE_BUCKETS.map((b, i) => <td key={b.key} style={cell} className={r.buckets[b.key] && i >= 3 ? 'col-red' : ''}>{r.buckets[b.key] || '—'}</td>)}
                      <td style={cell} className="text-sm text-muted">
                        {latest[r.client_id] ? `${fmtTime(latest[r.client_id].uploaded_at)} · +${latest[r.client_id].added} / −${latest[r.client_id].cleared_count}` : 'by hand'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card mb-16" style={{ flex: '1 1 220px' }}>
          <div className="card-header"><div className="card-title">🔢 Top reason codes</div></div>
          {reasons.length === 0 ? <div className="text-sm text-muted">No reason codes yet.</div> : reasons.map(([code, n]) => (
            <div key={code} className="row text-sm" style={{ justifyContent: 'space-between', padding: '2px 0' }}><span>{code}</span><b>{n}</b></div>
          ))}
        </div>
      </div>

      <MedicareTrackerList kind="rtp" items={items} ctx={ctx} people={people} names={names} user={user} onChanged={onChanged}
        badges={badges} sortKey={i => -rtpAge(i)}
        toolbar={canManageMedicare(user) && <button className="btn-sm" style={{ marginRight: 6 }} onClick={() => setUploading(true)}>⬆ Upload FISS list</button>} />

      {uploading && (
        <RtpUpload ctx={ctx} existing={items} user={user} onClose={() => setUploading(false)}
          onDone={r => {
            setUploading(false); onChanged();
            alertDialog({ title: 'List uploaded', message: `${r.added} new · ${r.updated} updated · ${r.cleared} cleared from FISS.`, tone: 'success' });
          }} />
      )}
    </>
  );
}
