import { useState, useEffect } from 'react';
import { S } from '../lib/supabase';

function HexLogo({ size = 82 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="hexG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
        <linearGradient id="helixG" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <polygon points="50,5 93,27.5 93,72.5 50,95 7,72.5 7,27.5" fill="url(#hexG)" />
      <path d="M34,30 Q50,42 66,30" stroke="url(#helixG)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M34,38 Q50,50 66,38" stroke="url(#helixG)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <line x1="42" y1="33" x2="42" y2="41" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="50" y1="36" x2="50" y2="44" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="58" y1="33" x2="58" y2="41" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
      <text x="50" y="78" textAnchor="middle" fill="white" fontSize="26" fontWeight="800"
        fontFamily="'Segoe UI',sans-serif" letterSpacing="-1">H</text>
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

const WRAP = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  padding: 20,
};

const CARD = {
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
  padding: '36px 32px',
  width: '100%',
  maxWidth: 380,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const FIELD = { marginBottom: 14, width: '100%' };
const LBL = { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 };
const INP = {
  width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
  borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  color: '#1a202c', background: '#f8fafc',
};

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
    <div style={WRAP}>
      <div style={CARD}>
        {/* Logo */}
        <HexLogo />
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1a202c', marginTop: 12, letterSpacing: '-0.5px' }}>
          Helix Hub
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, marginBottom: 28 }}>
          3Gen Consulting — RCM Team Portal
        </div>

        {view === 'login' ? (
          <form onSubmit={doLogin} style={{ width: '100%' }}>
            <div style={FIELD}>
              <label style={LBL} htmlFor="emp-id">Employee ID</label>
              <input
                id="emp-id"
                style={INP}
                type="text"
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                placeholder="e.g. EMP001"
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div style={FIELD}>
              <label style={LBL} htmlFor="login-pw">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-pw"
                  style={{ ...INP, paddingRight: 36 }}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <span
                  onClick={() => setShowPw(v => !v)}
                  title={showPw ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    cursor: 'pointer', fontSize: 15, color: '#64748b', userSelect: 'none',
                  }}
                >
                  {showPw ? '🙈' : '👁️'}
                </span>
              </div>
            </div>

            {error && (
              <div style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 14 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '10px', borderRadius: 7, border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #4338ca)',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1, marginBottom: 12,
              }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={toForgot}
              style={{ background: 'none', border: 'none', color: '#7c3aed', fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center' }}
            >
              Forgot Password?
            </button>
          </form>
        ) : (
          <form onSubmit={doForgot} style={{ width: '100%' }}>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16, textAlign: 'center', lineHeight: 1.5 }}>
              Enter your Employee ID and your administrator will reset your password.
            </p>
            <div style={FIELD}>
              <label style={LBL} htmlFor="forgot-id">Employee ID</label>
              <input
                id="forgot-id"
                style={INP}
                type="text"
                value={forgotId}
                onChange={e => setForgotId(e.target.value)}
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
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '10px', borderRadius: 7, border: 'none',
                  background: 'linear-gradient(135deg, #7c3aed, #4338ca)',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1, marginBottom: 12,
                }}
              >
                {loading ? 'Checking…' : 'Submit'}
              </button>
            )}

            <button
              type="button"
              onClick={toLogin}
              style={{ background: 'none', border: 'none', color: '#7c3aed', fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center' }}
            >
              ← Back to Sign In
            </button>
          </form>
        )}
      </div>

      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 20 }}>
        Created by Faizan Shah
      </div>
    </div>
  );
}
