import { useState, useEffect, useRef } from 'react';
import { S } from '../../lib/supabase';
import { fmtD, scopeToSupervisor } from '../../lib/helpers';
import { PRIORITIES } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import Discussion from '../../components/shared/Discussion';
import Toast from '../../components/shared/Toast';

const POLL_MS = 25000;

function PriorityBadge({ priority }) {
  const p = PRIORITIES.find(x => x.id === priority) ?? PRIORITIES[1];
  return <span className="badge" style={{ background: `${p.color}22`, color: p.color }}>{p.label}</span>;
}

function initials(name, empId) {
  return (name || empId || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}

export default function EmpFeedback({ user }) {
  const [feedbacks, setFeedbacks] = useState([]);
  const [myAcks, setMyAcks]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [viewItem, setViewItem]   = useState(null);
  const [toast, setToast]         = useState('');
  const lastSeenIdRef = useRef(null);

  useEffect(() => { load(); }, []);

  // Poll so new announcements show up without a manual refresh.
  useEffect(() => {
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [all, acks, users, customProcs] = await Promise.all([
      S.get('feedback'),
      S.get('feedback_acks', { emp_id: user.emp_id }),
      S.get('users'),
      S.get('processes'),
    ]);
    const mine = (all ?? [])
      .filter(f => {
        if (f.to_emp_id) return f.to_emp_id === user.emp_id;
        const sender = users?.find(u => u.emp_id === f.from_emp_id);
        if (sender?.role === 'supervisor' || sender?.role === 'manager') {
          return scopeToSupervisor(users ?? [], sender, customProcs ?? []).some(u => u.emp_id === user.emp_id);
        }
        return true;
      })
      .sort((a, b) => (b.created_at ?? b.date) > (a.created_at ?? a.date) ? 1 : -1);
    setFeedbacks(mine);
    setMyAcks(acks ?? []);

    const maxId = mine.reduce((m, x) => Math.max(m, x.id), 0);
    if (lastSeenIdRef.current != null && maxId > lastSeenIdRef.current) {
      const fresh = mine.filter(x => x.id > lastSeenIdRef.current);
      if (fresh.length > 0) setToast(`${fresh.length} new announcement${fresh.length > 1 ? 's' : ''}`);
    }
    lastSeenIdRef.current = maxId;
    if (!silent) setLoading(false);
  }

  // A team-wide announcement tracks acknowledgement per person (feedback_acks);
  // a 1:1 announcement only ever has one possible acknowledger, so the original
  // shared boolean on the row is still accurate for that case.
  function isAcked(f) {
    return f.to_emp_id ? !!f.acknowledged : myAcks.some(a => a.feedback_id === f.id);
  }

  function myAckTime(f) {
    if (f.to_emp_id) return f.acknowledged_at;
    return myAcks.find(a => a.feedback_id === f.id)?.acknowledged_at;
  }

  async function ack(item) {
    const now = new Date().toISOString();
    if (item.to_emp_id) {
      await S.update('feedback', { acknowledged: true, acknowledged_at: now }, { id: item.id });
      setFeedbacks(prev => prev.map(f => f.id === item.id ? { ...f, acknowledged: true, acknowledged_at: now } : f));
    } else {
      await S.set('feedback_acks', { feedback_id: item.id, emp_id: user.emp_id, acknowledged_at: now }, ['feedback_id', 'emp_id']);
      setMyAcks(prev => [...prev, { feedback_id: item.id, emp_id: user.emp_id, acknowledged_at: now }]);
    }
  }

  const unread = feedbacks.filter(f => !isAcked(f)).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            My Announcements
            {unread > 0 && <span className="badge badge-red">{unread} unread</span>}
          </div>
          <div className="page-subtitle">Updates and priorities from your team lead and supervisor</div>
        </div>
        <button className="btn-sm" onClick={() => load()}>↺ Refresh</button>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Total Messages</div>
          <div className="stat-value">{feedbacks.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unread</div>
          <div className={`stat-value ${unread > 0 ? 'col-red' : 'col-green'}`}>{unread}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Acknowledged</div>
          <div className="stat-value col-green">{feedbacks.filter(isAcked).length}</div>
        </div>
      </div>

      {loading && <div className="loading-row"><div className="spinner" /> Loading…</div>}

      {!loading && feedbacks.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 56 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No feedback yet</div>
        </div>
      )}

      {/* Feedback cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {feedbacks.map(f => {
          const acked = isAcked(f);
          const prio = PRIORITIES.find(x => x.id === f.priority) ?? PRIORITIES[1];
          return (
          <div
            key={f.id}
            className="card card-hover fade-in"
            style={{ borderLeft: `3px solid ${prio.color}`, padding: 0, overflow: 'hidden' }}
          >
            <div style={{ padding: '16px 20px', cursor: 'pointer' }} onClick={() => setViewItem(f)}>
              {/* Card header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #7c3aed, #4338ca)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {initials(f.from_name, f.from_emp_id)}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{f.from_name ?? f.from_emp_id}</span>
                      {f.to_emp_id === null && <span className="badge badge-blue">Team</span>}
                      {!acked && <span className="badge badge-red">New</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span className="text-sm text-muted">{fmtD(f.date)}</span>
                      {f.process && <span className="badge badge-yellow">{f.process}</span>}
                    </div>
                  </div>
                </div>
                <span className="badge" style={{ background: `${prio.color}1a`, color: prio.color, fontWeight: 700 }}>
                  {prio.label}
                </span>
              </div>

              {/* Message preview */}
              <p style={{
                fontSize: 13.5, lineHeight: 1.6,
                color: acked ? 'var(--text-muted)' : 'var(--text)',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}>
                {f.message}
              </p>
              {f.image_url && <img src={f.image_url} alt="" style={{ maxWidth: 200, borderRadius: 8, marginTop: 8 }} />}
            </div>

            {/* Status + Ack button */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)',
            }}>
              <span className={`badge ${acked ? 'badge-green' : 'badge-yellow'}`} style={{ fontSize: 10 }}>
                {acked
                  ? `Acknowledged${myAckTime(f) ? ' · ' + new Date(myAckTime(f)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}`
                  : 'Awaiting Acknowledgement'}
              </span>
              {!acked && (
                <button className="btn-sm" onClick={() => ack(f)}>
                  ✓ Acknowledge
                </button>
              )}
            </div>

            <div style={{ padding: '10px 20px' }}>
              <Discussion targetType="feedback" targetId={f.id} user={user} />
            </div>
          </div>
          );
        })}
      </div>

      {/* Full view modal */}
      {viewItem && (
        <Modal title={`Feedback from ${viewItem.from_name ?? viewItem.from_emp_id}`} onClose={() => setViewItem(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            {[
              ['From',    viewItem.from_name ?? viewItem.from_emp_id],
              ['Date',    fmtD(viewItem.date)],
              ['Time',    viewItem.created_at ? new Date(viewItem.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'],
              ['Process', viewItem.process ?? '—'],
              ['Priority', <PriorityBadge key="p" priority={viewItem.priority} />],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">{k}</span>
                <span className="bold">{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Status</span>
              <span className={`badge ${isAcked(viewItem) ? 'badge-green' : 'badge-yellow'}`}>
                {isAcked(viewItem) ? 'Acknowledged' : 'Awaiting'}
              </span>
            </div>
            {isAcked(viewItem) && myAckTime(viewItem) && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">Acknowledged At</span>
                <span className="bold">{new Date(myAckTime(viewItem)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />
            <p style={{ lineHeight: 1.75, color: 'var(--text)', whiteSpace: 'pre-wrap', fontSize: 13 }}>
              {viewItem.message}
            </p>
            {viewItem.image_url && <img src={viewItem.image_url} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />}
          </div>
          <div className="form-actions">
            {!isAcked(viewItem) && (
              <button className="btn-sm" onClick={() => { ack(viewItem); setViewItem(null); }}>
                ✓ Acknowledge
              </button>
            )}
            <button className="btn-primary" onClick={() => setViewItem(null)}>Close</button>
          </div>
        </Modal>
      )}
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
