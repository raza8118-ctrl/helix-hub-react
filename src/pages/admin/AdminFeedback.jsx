import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { today, fmtD } from '../../lib/helpers';
import { ACCESSES } from '../../lib/constants';
import Modal from '../../components/shared/Modal';

export default function AdminFeedback({ user }) {
  const [toEmpId, setToEmpId]     = useState('ALL');
  const [filterProc, setProc]     = useState('ALL');
  const [message, setMessage]     = useState('');
  const [date, setDate]           = useState(today());
  const [allUsers, setAllUsers]   = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [sending, setSending]     = useState(false);
  const [viewItem, setViewItem]   = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [u, f] = await Promise.all([
      S.get('users', { active: true }),
      S.get('feedback'),
    ]);
    setAllUsers(u ?? []);
    setFeedbacks(
      (f ?? []).sort((a, b) => (b.created_at ?? b.date) > (a.created_at ?? a.date) ? 1 : -1)
    );
    setLoading(false);
  }

  async function sendFeedback(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    await S.set('feedback', {
      from_emp_id: user.emp_id,
      from_name: user.name ?? user.emp_id,
      to_emp_id: toEmpId === 'ALL' ? null : toEmpId,
      to_name: toEmpId === 'ALL' ? 'Team' : (allUsers.find(u => u.emp_id === toEmpId)?.name ?? toEmpId),
      process: filterProc === 'ALL' ? null : filterProc,
      message: message.trim(),
      date,
      acknowledged: false,
      created_at: new Date().toISOString(),
    });
    setMessage('');
    setSending(false);
    await loadAll();
  }

  async function deleteFeedback(id) {
    if (!window.confirm('Delete this feedback?')) return;
    await S.del('feedback', { id });
    setFeedbacks(prev => prev.filter(f => f.id !== id));
  }

  async function toggleAck(item) {
    await S.update('feedback', { acknowledged: !item.acknowledged }, { id: item.id });
    setFeedbacks(prev => prev.map(f => f.id === item.id ? { ...f, acknowledged: !f.acknowledged } : f));
  }

  const filteredEmpUsers = filterProc === 'ALL'
    ? allUsers
    : allUsers.filter(u => u.access === filterProc || u.access === 'ALL');

  const displayFeedbacks = feedbacks.filter(f => {
    const procOk  = filterProc === 'ALL' || f.process === filterProc || f.process == null;
    const agentOk = toEmpId === 'ALL' || f.to_emp_id === toEmpId || f.from_emp_id === toEmpId;
    return procOk && agentOk;
  });

  const unread = feedbacks.filter(f => !f.acknowledged).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Team Feedback
            {unread > 0 && <span className="badge badge-red">{unread} unread</span>}
          </div>
          <div className="page-subtitle">Send and track feedback for team members</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
        {/* Send form */}
        <div className="card">
          <div className="card-header"><div className="card-title">Send Feedback</div></div>
          <form onSubmit={sendFeedback} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Process Filter</label>
                <select value={filterProc} onChange={e => setProc(e.target.value)}>
                  <option value="ALL">All Processes</option>
                  {ACCESSES.slice(0, 4).map(a => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="field">
                <label>To Employee</label>
                <select value={toEmpId} onChange={e => setToEmpId(e.target.value)}>
                  <option value="ALL">Entire Team</option>
                  {filteredEmpUsers.map(u => <option key={u.emp_id} value={u.emp_id}>{u.name ?? u.emp_id}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea
                rows={5}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Enter feedback, comments, or recognition…"
                required
                style={{ resize: 'vertical' }}
              />
            </div>
            <button className="btn-primary" type="submit" disabled={sending || !message.trim()}>
              {sending ? 'Sending…' : '✉ Send Feedback'}
            </button>
          </form>
        </div>

        {/* Stats panel */}
        <div className="card" style={{ padding: '16px 18px' }}>
          <div className="card-header"><div className="card-title">Filter & Stats</div></div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>View by Employee</label>
            <select value={toEmpId} onChange={e => setToEmpId(e.target.value)}>
              <option value="ALL">All</option>
              {allUsers.map(u => <option key={u.emp_id} value={u.emp_id}>{u.name ?? u.emp_id}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            {[
              ['Total Records', feedbacks.length, ''],
              ['Unread', unread, unread > 0 ? 'col-red' : 'col-green'],
              ['Showing', displayFeedbacks.length, ''],
            ].map(([label, val, cls]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span className="text-muted">{label}</span>
                <span className={`bold ${cls}`}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Feedback history */}
      <div className="card mt-4">
        <div className="card-header">
          <div className="card-title">Feedback History</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>From</th>
                <th>To</th>
                <th>Process</th>
                <th>Message</th>
                <th className="center">Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayFeedbacks.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No feedback found</td></tr>
              )}
              {displayFeedbacks.map(f => (
                <tr key={f.id} style={!f.acknowledged ? { background: 'rgba(59,130,246,0.04)' } : undefined}>
                  <td className="text-sm">{fmtD(f.date)}</td>
                  <td className="bold text-sm">{f.from_name ?? f.from_emp_id}</td>
                  <td className="text-sm">
                    {f.to_emp_id ? (f.to_name ?? f.to_emp_id) : <span className="badge badge-blue">Team</span>}
                  </td>
                  <td className="text-sm text-muted">{f.process ?? '—'}</td>
                  <td
                    className="text-sm"
                    style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                    title={f.message}
                    onClick={() => setViewItem(f)}
                  >
                    {f.message}
                  </td>
                  <td className="center">
                    <button onClick={() => toggleAck(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 }}
                      title={f.acknowledged ? 'Mark unread' : 'Mark acknowledged'}>
                      {f.acknowledged
                        ? <span className="badge badge-green">Acknowledged</span>
                        : <span className="badge badge-yellow">Awaiting</span>}
                    </button>
                  </td>
                  <td>
                    <button className="btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => deleteFeedback(f.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* View full feedback */}
      {viewItem && (
        <Modal title={`Feedback — ${fmtD(viewItem.date)}`} onClose={() => setViewItem(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            {[
              ['From', viewItem.from_name ?? viewItem.from_emp_id],
              ['To', viewItem.to_name ?? 'Entire Team'],
              ['Process', viewItem.process ?? '—'],
              ['Date', fmtD(viewItem.date)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">{k}</span>
                <span className="bold">{v}</span>
              </div>
            ))}
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />
            <p style={{ lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{viewItem.message}</p>
          </div>
          <div className="form-actions">
            {!viewItem.acknowledged && (
              <button className="btn-sm" onClick={() => { toggleAck(viewItem); setViewItem(null); }}>
                Mark Acknowledged
              </button>
            )}
            <button className="btn-primary" onClick={() => setViewItem(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
