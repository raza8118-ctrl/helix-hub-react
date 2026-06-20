import { useState, useEffect } from 'react';
import { S, storage } from '../../lib/supabase';
import { today, fmtD, resizeImage } from '../../lib/helpers';
import { ACCESSES, PRIORITIES, FEED_BUCKET } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import ReactionBar from '../../components/shared/ReactionBar';
import CommentThread from '../../components/shared/CommentThread';

function PriorityBadge({ priority }) {
  const p = PRIORITIES.find(x => x.id === priority) ?? PRIORITIES[1];
  return <span className="badge" style={{ background: `${p.color}22`, color: p.color }}>{p.label}</span>;
}

export default function AdminFeedback({ user }) {
  const [toEmpId, setToEmpId]     = useState('ALL');
  const [filterProc, setProc]     = useState('ALL');
  const [message, setMessage]     = useState('');
  const [priority, setPriority]   = useState('normal');
  const [imageUrl, setImageUrl]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [date, setDate]           = useState(today());
  const [allUsers, setAllUsers]   = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [sending, setSending]     = useState(false);
  const [viewItem, setViewItem]   = useState(null);
  const [acks, setAcks]           = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [u, f, a] = await Promise.all([
      S.get('users', { active: true }),
      S.get('feedback'),
      S.get('feedback_acks'),
    ]);
    setAllUsers(u ?? []);
    setFeedbacks(
      (f ?? []).sort((a, b) => (b.created_at ?? b.date) > (a.created_at ?? a.date) ? 1 : -1)
    );
    setAcks(a ?? []);
    setLoading(false);
  }

  // Who an announcement actually reached: the one named recipient, or every active
  // employee in the targeted process (or everyone, if it went to the whole team).
  function audienceFor(f) {
    if (f.to_emp_id) return allUsers.filter(u => u.emp_id === f.to_emp_id);
    return allUsers.filter(u => u.role === 'employee' && (!f.process || u.access === f.process || u.access === 'ALL'));
  }

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setUploadErr('Please pick an image file.'); return; }
    setUploadErr(''); setUploading(true);
    try {
      const blob = await resizeImage(file);
      const url = await storage.uploadFile(FEED_BUCKET, `announcements/${user.emp_id}/${Date.now()}.jpg`, blob);
      if (!url) throw new Error('upload failed');
      setImageUrl(url);
    } catch {
      setUploadErr('Upload failed — check the "feed-media" Storage bucket exists and is public.');
    }
    setUploading(false);
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
      priority,
      image_url: imageUrl || null,
      date,
      acknowledged: false,
      created_at: new Date().toISOString(),
    });
    setMessage(''); setPriority('normal'); setImageUrl('');
    setSending(false);
    await loadAll();
  }

  async function deleteFeedback(id) {
    if (!window.confirm('Delete this announcement?')) return;
    await S.del('feedback', { id });
    setFeedbacks(prev => prev.filter(f => f.id !== id));
  }

  async function toggleAck(item) {
    const next = !item.acknowledged;
    const ackedAt = next ? new Date().toISOString() : null;
    await S.update('feedback', { acknowledged: next, acknowledged_at: ackedAt }, { id: item.id });
    setFeedbacks(prev => prev.map(f => f.id === item.id ? { ...f, acknowledged: next, acknowledged_at: ackedAt } : f));
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
            Announcements
            {unread > 0 && <span className="badge badge-red">{unread} unread</span>}
          </div>
          <div className="page-subtitle">Send updates and priorities to your team</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
        {/* Send form */}
        <div className="card">
          <div className="card-header"><div className="card-title">New Announcement</div></div>
          <form onSubmit={sendFeedback} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Process</label>
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
              <div className="field">
                <label>Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value)}>
                  {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Message</label>
              <textarea
                rows={5}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="e.g. Pending emails for today, what to work on, process update…"
                required
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className="field">
              <label>Snapshot (optional)</label>
              {imageUrl ? (
                <div style={{ position: 'relative', maxWidth: 200 }}>
                  <img src={imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />
                  <button type="button" className="btn-sm" onClick={() => setImageUrl('')} style={{ position: 'absolute', top: 4, right: 4 }}>✕</button>
                </div>
              ) : (
                <label className="btn-sm" style={{ cursor: 'pointer', width: 'fit-content' }}>
                  📷 {uploading ? 'Uploading…' : 'Add Snapshot'}
                  <input type="file" accept="image/*" onChange={pickImage} disabled={uploading} style={{ display: 'none' }} />
                </label>
              )}
              {uploadErr && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{uploadErr}</div>}
            </div>
            <button className="btn-primary" type="submit" disabled={sending || !message.trim()}>
              {sending ? 'Sending…' : '✉ Send Announcement'}
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

      {/* Announcement feed */}
      <div className="mt-4">
        <div className="card-title" style={{ marginBottom: 10 }}>
          Announcement History {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        {displayFeedbacks.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No announcements found</div>
        )}
        {displayFeedbacks.map(f => {
          const isBroadcast = !f.to_emp_id;
          const audience = audienceFor(f);
          const myAcks = acks.filter(a => a.feedback_id === f.id);
          const ackTimeOf = empId => myAcks.find(a => a.emp_id === empId)?.acknowledged_at;
          const acked = audience.filter(u => myAcks.some(a => a.emp_id === u.emp_id));
          const pending = audience.filter(u => !myAcks.some(a => a.emp_id === u.emp_id));
          const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          return (
            <div key={f.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="bold text-sm">{f.from_name ?? f.from_emp_id}</span>
                  <span className="text-muted text-sm">→ {f.to_emp_id ? (f.to_name ?? f.to_emp_id) : 'Team'}</span>
                  {f.process && <span className="badge badge-yellow">{f.process}</span>}
                  <PriorityBadge priority={f.priority} />
                </div>
                <span className="text-sm text-muted">{fmtD(f.date)}</span>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.55, cursor: 'pointer' }} onClick={() => setViewItem(f)}>{f.message}</p>
              {f.image_url && <img src={f.image_url} alt="" style={{ maxWidth: 240, borderRadius: 8, marginBottom: 8 }} />}

              <ReactionBar targetType="feedback" targetId={f.id} user={user} />

              <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {isBroadcast ? (
                  <span className="badge badge-green">✓ Acknowledged {acked.length}/{audience.length}</span>
                ) : (
                  <button className="btn-sm" onClick={() => toggleAck(f)}>
                    {f.acknowledged ? <span className="badge badge-green">Acknowledged</span> : <span className="badge badge-yellow">Awaiting</span>}
                  </button>
                )}
                {!isBroadcast && f.acknowledged && f.acknowledged_at && (
                  <span className="text-muted text-sm">at {fmtTime(f.acknowledged_at)}</span>
                )}
                <button className="btn-sm" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => deleteFeedback(f.id)}>Delete</button>
              </div>
              {isBroadcast && acked.length > 0 && (
                <div className="text-muted text-sm" style={{ marginBottom: 4 }}>
                  ✓ {acked.map(u => `${u.name ?? u.emp_id} (${fmtTime(ackTimeOf(u.emp_id))})`).join(', ')}
                </div>
              )}
              {isBroadcast && pending.length > 0 && (
                <div className="text-muted text-sm" style={{ marginBottom: 8 }}>
                  ⏳ Pending: {pending.map(u => u.name ?? u.emp_id).join(', ')}
                </div>
              )}

              <div className="text-muted text-sm bold" style={{ marginBottom: 4 }}>💬 Comments</div>
              <CommentThread targetType="feedback" targetId={f.id} user={user} />
            </div>
          );
        })}
      </div>

      {/* View full announcement */}
      {viewItem && (
        <Modal title={`Announcement — ${fmtD(viewItem.date)}`} onClose={() => setViewItem(null)}>
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
            {viewItem.image_url && <img src={viewItem.image_url} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />}
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
