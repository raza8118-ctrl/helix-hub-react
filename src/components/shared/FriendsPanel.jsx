import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import Modal from './Modal';

const TABS = [
  { id: 'friends',  label: 'Friends' },
  { id: 'requests', label: 'Requests' },
  { id: 'find',     label: 'Find People' },
];

export default function FriendsPanel({ user, onClose }) {
  const [tab, setTab]                 = useState('friends');
  const [allUsers, setAllUsers]       = useState([]);
  const [requests, setRequests]       = useState([]);
  const [closeFriends, setCloseFriends] = useState([]);
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [u, r, c] = await Promise.all([
      S.get('users'),
      S.get('friend_requests'),
      S.get('close_friends', { owner_emp_id: user.emp_id }),
    ]);
    setAllUsers((u ?? []).filter(x => x.emp_id !== user.emp_id));
    setRequests(r ?? []);
    setCloseFriends(c ?? []);
    setLoading(false);
  }

  const myEmpId = user.emp_id;
  const accepted   = requests.filter(r => r.status === 'accepted' && (r.from_emp_id === myEmpId || r.to_emp_id === myEmpId));
  const incoming   = requests.filter(r => r.status === 'pending' && r.to_emp_id === myEmpId);
  const outgoing   = requests.filter(r => r.status === 'pending' && r.from_emp_id === myEmpId);
  const friendIds  = accepted.map(r => r.from_emp_id === myEmpId ? r.to_emp_id : r.from_emp_id);
  const closeIds   = closeFriends.map(c => c.friend_emp_id);

  const userById = id => allUsers.find(u => u.emp_id === id);

  function statusWith(empId) {
    if (friendIds.includes(empId)) return 'friends';
    if (outgoing.some(r => r.to_emp_id === empId)) return 'pending-sent';
    if (incoming.some(r => r.from_emp_id === empId)) return 'pending-received';
    return 'none';
  }

  async function sendRequest(empId) {
    await S.set('friend_requests', { from_emp_id: myEmpId, to_emp_id: empId, status: 'pending' });
    await load();
  }

  async function respond(req, accept) {
    await S.update('friend_requests', { status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() }, { id: req.id });
    await load();
  }

  async function unfriend(empId) {
    if (!window.confirm('Remove this friend?')) return;
    const req = accepted.find(r => r.from_emp_id === empId || r.to_emp_id === empId);
    if (req) await S.del('friend_requests', { id: req.id });
    await S.del('close_friends', { owner_emp_id: myEmpId, friend_emp_id: empId });
    await load();
  }

  async function toggleClose(empId) {
    if (closeIds.includes(empId)) {
      await S.del('close_friends', { owner_emp_id: myEmpId, friend_emp_id: empId });
    } else {
      await S.set('close_friends', { owner_emp_id: myEmpId, friend_emp_id: empId });
    }
    await load();
  }

  const searchResults = allUsers.filter(u => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return (u.name ?? '').toLowerCase().includes(q) || (u.emp_id ?? '').toLowerCase().includes(q);
  });

  return (
    <Modal title="Friends" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className="btn-sm"
            onClick={() => setTab(t.id)}
            style={tab === t.id ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
          >
            {t.label}
            {t.id === 'requests' && incoming.length > 0 ? ` (${incoming.length})` : ''}
          </button>
        ))}
      </div>

      {loading && <div className="loading-row"><div className="spinner" /> Loading…</div>}

      {!loading && tab === 'friends' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {friendIds.length === 0 && <div className="text-muted text-sm">No friends yet — try "Find People".</div>}
          {friendIds.map(id => {
            const u = userById(id);
            const isClose = closeIds.includes(id);
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6 }}>
                <div>
                  <div className="bold" style={{ fontSize: 13 }}>{u?.name ?? id}</div>
                  <div className="text-muted text-sm">{id}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn-sm"
                    onClick={() => toggleClose(id)}
                    style={isClose ? { background: '#f59e0b', color: '#fff', border: 'none' } : {}}
                    title="Close Friend — sees your Close Friends-only posts"
                  >
                    ⭐ {isClose ? 'Close Friend' : 'Mark Close'}
                  </button>
                  <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => unfriend(id)}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && tab === 'requests' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="text-sm bold" style={{ marginBottom: 6 }}>Incoming</div>
            {incoming.length === 0 && <div className="text-muted text-sm">No pending requests.</div>}
            {incoming.map(r => {
              const u = userById(r.from_emp_id);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6, marginBottom: 6 }}>
                  <div>
                    <div className="bold" style={{ fontSize: 13 }}>{u?.name ?? r.from_emp_id}</div>
                    <div className="text-muted text-sm">{r.from_emp_id}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-primary btn-sm" onClick={() => respond(r, true)}>Accept</button>
                    <button className="btn-sm" onClick={() => respond(r, false)}>Decline</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <div className="text-sm bold" style={{ marginBottom: 6 }}>Sent</div>
            {outgoing.length === 0 && <div className="text-muted text-sm">No outgoing requests.</div>}
            {outgoing.map(r => {
              const u = userById(r.to_emp_id);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6, marginBottom: 6 }}>
                  <div>
                    <div className="bold" style={{ fontSize: 13 }}>{u?.name ?? r.to_emp_id}</div>
                    <div className="text-muted text-sm">{r.to_emp_id}</div>
                  </div>
                  <span className="badge badge-gray">Pending</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && tab === 'find' && (
        <div>
          <input
            type="text" placeholder="Search by name or Employee ID…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {search.trim() && searchResults.length === 0 && (
              <div className="text-muted text-sm">No matches.</div>
            )}
            {searchResults.map(u => {
              const status = statusWith(u.emp_id);
              return (
                <div key={u.emp_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6 }}>
                  <div>
                    <div className="bold" style={{ fontSize: 13 }}>{u.name ?? u.emp_id}</div>
                    <div className="text-muted text-sm">{u.emp_id}</div>
                  </div>
                  {status === 'none' && <button className="btn-primary btn-sm" onClick={() => sendRequest(u.emp_id)}>Add Friend</button>}
                  {status === 'pending-sent' && <span className="badge badge-gray">Requested</span>}
                  {status === 'pending-received' && <span className="badge badge-yellow">Wants to connect</span>}
                  {status === 'friends' && <span className="badge badge-green">Friends</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
