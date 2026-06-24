import { useState, useEffect } from 'react';
import { S } from '../lib/supabase';

function HexLogo({ size = 82 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="markG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id="strandG" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="24" fill="url(#markG)" />
      <path d="M36,21 C36,38 64,38 64,50 C64,62 36,62 36,79"
        stroke="url(#strandG)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M64,21 C64,38 36,38 36,50 C36,62 64,62 64,79"
        stroke="url(#strandG)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <line x1="42" y1="29" x2="58" y2="29" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />
      <line x1="48" y1="50" x2="52" y2="50" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />
      <line x1="42" y1="71" x2="58" y2="71" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function EyeIcon({ off }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="21" x2="21" y2="3" />}
    </svg>
  );
}

async function ensureAdmin() {
  try {
    const rows = await S.get('users');
    if (!rows || rows.length === 0) {
      await S.set('users', {
        emp_id: 'ADMIN',
        name: 'Administrator',
        password: 'Admin@123',
        role: 'admin',
        process: 'ALL',
        access: 'ALL',
        active: true,
      });
    }
  } catch (err) {
    console.warn('ensureAdmin:', err);
  }
}

const CARD = {
  background: '#fff',
  borderRadius: 20,
  boxShadow: '0 24px 60px -12px rgba(15,12,41,0.18), 0 2px 8px rgba(15,12,41,0.04)',
  border: '1px solid #eef1f6',
  padding: '40px 34px',
  width: '100%',
  maxWidth: 380,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const FEATURES = [
  { text: 'Live productivity, attendance, and quality tracking' },
  { text: 'Role-aware dashboards for employees, supervisors, and managers' },
  { text: 'Team announcements with read receipts, all in one place' },
];

// Login's own light-card inputs/labels — same shape as the global `.form-group`/
// `input`/`label` rules in index.css, but forced to light colors since this page
// renders before any theme preference is loaded (always a white card).
const LBL = { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 };
const INP = {
  width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
  borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  color: '#1a202c', background: '#f8fafc',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};
const INP_FOCUS = { borderColor: '#7c3aed', boxShadow: '0 0 0 3px rgba(124,58,237,0.15)' };

export default function Login({ onLogin }) {
  const [view, setView]         = useState('login');
  const [empId, setEmpId]       = useState('');
  const [password, setPassword] = useState('');
  const [forgotId, setForgotId] = useState('');
  const [error, setError]       = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotOk, setForgotOk]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [showPw, setShowPw]       = useState(false);
  const [focused, setFocused]     = useState('');

  useEffect(() => { ensureAdmin(); }, []);

  async function doLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const rows = await S.get('users', { emp_id: empId.trim().toUpperCase() });
      const u = rows?.[0];
      if (!u || u.password !== password) {
        setError('Invalid Employee ID or password.');
        setLoading(false);
        return;
      }
      sessionStorage.setItem('hh_user', JSON.stringify(u));
      onLogin(u);
    } catch {
      setError('Connection error. Please try again.');
    }
    setLoading(false);
  }

  async function doForgot(e) {
    e.preventDefault();
    setForgotMsg('');
    setForgotOk(false);
    setLoading(true);
    try {
      const rows = await S.get('users', { emp_id: forgotId.trim().toUpperCase() });
      if (!rows?.length) {
        setForgotMsg('No account found with that Employee ID.');
      } else {
        setForgotMsg('Account found. Please contact your administrator to reset your password.');
        setForgotOk(true);
      }
    } catch {
      setForgotMsg('Connection error. Please try again.');
    }
    setLoading(false);
  }

  function toForgot() { setView('forgot'); setError(''); setForgotMsg(''); setForgotOk(false); setForgotId(''); }
  function toLogin()  { setView('login');  setForgotMsg(''); setForgotOk(false); }

  return (
    <div className="login-shell">
      {/* Brand panel — hidden on narrow screens */}
      <div className="login-brand-panel">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <HexLogo size={56} />
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, color: '#fff', marginTop: 20, letterSpacing: '-0.5px' }}>
            Helix Hub
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', marginTop: 6, maxWidth: 360, lineHeight: 1.6 }}>
            The RCM team portal for 3Gen Consulting — track performance, manage your team, and stay in sync.
          </div>
          {FEATURES.map(f => (
            <div key={f.text} className="login-feature">
              <span className="login-feature-icon"><CheckIcon /></span>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
        <div style={{ position: 'relative', zIndex: 1, color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 48 }}>
          Created by Faizan Shah
        </div>
      </div>

      {/* Form panel */}
      <div className="login-form-panel">
        <div style={CARD} className="fade-in-scale">
          {/* Logo (shown here too — the brand panel collapses on narrow screens) */}
          <HexLogo />
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: '#1a202c', marginTop: 12, letterSpacing: '-0.5px' }}>
            Helix Hub
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, marginBottom: 28 }}>
            3Gen Consulting — RCM Team Portal
          </div>

        {view === 'login' ? (
          <form onSubmit={doLogin} style={{ width: '100%' }}>
            <div className="form-group">
              <label style={LBL} htmlFor="emp-id">Employee ID</label>
              <input
                id="emp-id"
                style={focused === 'emp-id' ? { ...INP, ...INP_FOCUS } : INP}
                type="text"
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                onFocus={() => setFocused('emp-id')}
                onBlur={() => setFocused('')}
                placeholder="e.g. EMP001"
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label style={LBL} htmlFor="login-pw">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-pw"
                  style={focused === 'login-pw' ? { ...INP, ...INP_FOCUS, paddingRight: 36 } : { ...INP, paddingRight: 36 }}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocused('login-pw')}
                  onBlur={() => setFocused('')}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <span
                  onClick={() => setShowPw(v => !v)}
                  title={showPw ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    cursor: 'pointer', color: '#94a3b8', userSelect: 'none',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <EyeIcon off={showPw} />
                </span>
              </div>
            </div>

            {error && (
              <div style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 14 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-login btn-lg" style={{ marginBottom: 12 }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <button type="button" onClick={toForgot} className="btn-link">
              Forgot Password?
            </button>
          </form>
        ) : (
          <form onSubmit={doForgot} style={{ width: '100%' }}>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16, textAlign: 'center', lineHeight: 1.5 }}>
              Enter your Employee ID and your administrator will reset your password.
            </p>
            <div className="form-group">
              <label style={LBL} htmlFor="forgot-id">Employee ID</label>
              <input
                id="forgot-id"
                style={focused === 'forgot-id' ? { ...INP, ...INP_FOCUS } : INP}
                type="text"
                value={forgotId}
                onChange={e => setForgotId(e.target.value)}
                onFocus={() => setFocused('forgot-id')}
                onBlur={() => setFocused('')}
                placeholder="e.g. EMP001"
                required
                autoFocus
              />
            </div>

            {forgotMsg && (
              <div style={{
                borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 14,
                background: forgotOk ? '#dcfce7' : '#fee2e2',
                color: forgotOk ? '#15803d' : '#dc2626',
              }}>
                {forgotMsg}
              </div>
            )}

            {!forgotOk && (
              <button type="submit" disabled={loading} className="btn btn-login btn-lg" style={{ marginBottom: 12 }}>
                {loading ? 'Checking…' : 'Submit'}
              </button>
            )}

            <button type="button" onClick={toLogin} className="btn-link">
              ← Back to Sign In
            </button>
          </form>
        )}
        </div>
      </div>
    </div>
  );
}
