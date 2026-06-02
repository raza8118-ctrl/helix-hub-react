import { useState, useEffect } from 'react';
import { THEMES } from '../../lib/constants';
import { S } from '../../lib/supabase';

export default function Profile({ user, theme: currentTheme, onTheme, onClose, onSave }) {
  const [name, setName]         = useState(user.name || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [newPw, setNewPw]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState('');

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const initials = (user.name || user.emp_id || '?')
    .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

  const joinedDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  async function handleSave() {
    setSaving(true);
    setMsg('');
    try {
      const updates = {};
      if (name.trim() && name.trim() !== user.name) updates.name = name.trim();
      if (avatarUrl.trim() !== (user.avatar_url || '')) updates.avatar_url = avatarUrl.trim() || null;
      if (newPw.trim()) updates.password = newPw.trim();

      if (Object.keys(updates).length > 0) {
        await S.update('users', updates, { emp_id: user.emp_id });
      }

      const updated = { ...user, ...updates };
      localStorage.setItem('hh_user', JSON.stringify(updated));
      onSave(updated);
      setMsg('Profile saved!');
    } catch {
      setMsg('Save failed. Please try again.');
    }
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box fade-in-scale"
        style={{ maxWidth: 480 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">My Profile</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}
          >✕</button>
        </div>

        <div className="modal-body">
          {/* Avatar + identity */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 22 }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" style={{ width: 76, height: 76, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)' }} />
            ) : (
              <div style={{
                width: 76, height: 76, borderRadius: '50%',
                background: 'linear-gradient(135deg, #7c3aed, #4338ca)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28, fontWeight: 700, color: '#fff',
                border: '3px solid var(--accent)',
              }}>
                {initials}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 10 }}>{user.name || user.emp_id}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3, display: 'flex', gap: 8 }}>
              <span>{user.emp_id}</span>
              <span>·</span>
              <span style={{ textTransform: 'capitalize' }}>{user.role}</span>
              {joinedDate && <><span>·</span><span>Joined {joinedDate}</span></>}
            </div>
          </div>

          {/* Form */}
          <div className="form-group">
            <label>Display Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name" />
          </div>
          <div className="form-group">
            <label>Profile Picture URL</label>
            <input type="url" value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Leave blank to keep current" />
          </div>

          {/* Theme selector */}
          <div style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Theme</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {THEMES.map(t => (
                <button
                  key={t.id}
                  onClick={() => onTheme(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                    border: currentTheme === t.id
                      ? '2px solid var(--accent)'
                      : '2px solid var(--border)',
                    background: 'var(--surface)',
                    transition: 'border-color 0.15s',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    <div style={{ width: 13, height: 13, borderRadius: 2, background: t.bg, border: '1px solid rgba(0,0,0,0.12)' }} />
                    <div style={{ width: 13, height: 13, borderRadius: 2, background: t.topbar, border: '1px solid rgba(0,0,0,0.12)' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: currentTheme === t.id ? 700 : 400, color: 'var(--text)' }}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {msg && (
            <div style={{
              fontSize: 12, padding: '6px 10px', borderRadius: 4,
              marginBottom: 12,
              background: msg.includes('saved') ? '#dcfce7' : '#fee2e2',
              color: msg.includes('saved') ? '#15803d' : '#dc2626',
            }}>
              {msg}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '7px 16px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
