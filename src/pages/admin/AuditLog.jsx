import { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/supabase';
import { today, dlCSV } from '../../lib/helpers';
import { canViewAudit } from '../../lib/audit';

const ROW_LIMIT = 2000;

// Plain-English names for logged actions; unknown actions show as-is
const ACTION_LABELS = {
  sign_in:               'Signed in',
  owner_open_company:    'Owner opened company',
  create_user:           'Created user',
  edit_user:             'Edited user',
  activate_user:         'Activated user',
  deactivate_user:       'Deactivated user',
  set_team:              'Changed team / QA',
  grant_audit_access:    'Gave Audit Log access',
  revoke_audit_access:   'Removed Audit Log access',
  grant_access:          'Gave access',
  revoke_access:         'Removed access',
  create_client:         'Added client',
  edit_client:           'Edited client',
  activate_client:       'Reactivated client',
  deactivate_client:     'Made client inactive',
  create_payer:          'Added payer',
  edit_payer:            'Edited payer',
  activate_payer:        'Reactivated payer',
  deactivate_payer:      'Made payer inactive',
  add_payer_info:        'Added payer details',
  edit_payer_info:       'Edited payer details',
  activate_payer_info:   'Reactivated payer details',
  deactivate_payer_info: 'Made payer details inactive',
  assign_team:           'Assigned supervisor team',
  reset_password:        'Reset password',
  edit_counts:           'Edited counts',
  edit_hourly_counts:    'Edited hourly counts',
  edit_quality:          'Edited quality',
  bypass:                'Deadline bypass',
  remove_bypass:         'Removed deadline bypass',
  quality_bypass:        'Quality bypass',
  remove_quality_bypass: 'Removed quality bypass',
  pin:                   'Pinned employee',
  unpin:                 'Unpinned employee',
  change_shift_timing:   'Changed shift timing',
  save_ai_key:           'Saved AI key',
  clear_ai_key:          'Cleared AI key',
  save_task_targets:     'Saved task targets',
  reset_task_targets:    'Reset task targets',
  add_task:              'Added task',
  edit_task:             'Edited task',
  delete_task:           'Deleted task',
  create_allocation:     'Allocated work',
  post_announcement:     'Posted announcement',
  delete_announcement:   'Deleted announcement',
};
const actionLabel = a => ACTION_LABELS[a] ?? a;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Local-day boundaries → ISO timestamps
const startOf = date => new Date(`${date}T00:00:00`).toISOString();
const endOf   = date => new Date(`${date}T23:59:59.999`).toISOString();

function fmtWhen(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDetails(d) {
  if (d == null) return '';
  if (typeof d !== 'object') return String(d);
  return Object.entries(d)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

const recordOf = r => [r.entity_type ?? r.details?.entity_type, r.entity_id ?? r.details?.entity_id].filter(Boolean).join(' #');

/** Read-only list of everything recorded by logAudit(). */
export default function AuditLog({ user }) {
  const [from, setFrom]       = useState(daysAgo(6));
  const [to, setTo]           = useState(today());
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [actor, setActor]     = useState('ALL');
  const [action, setAction]   = useState('ALL');
  const [search, setSearch]   = useState('');
  const allowed = canViewAudit(user);

  useEffect(() => {
    if (!allowed || !from || !to) return;
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      const { data, error: err } = await db('audit_log')
        .select('*')
        .gte('created_at', startOf(from))
        .lte('created_at', endOf(to))
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT);
      if (!alive) return;
      if (err) { setError('Could not load the audit log.'); setRows([]); }
      else setRows(data ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [allowed, from, to]);

  const actors  = useMemo(() => [...new Map(rows.map(r => [r.actor_emp_id, r.actor_name ?? r.actor_emp_id])).entries()]
    .filter(([id]) => id).sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [rows]);
  const actions = useMemo(() => [...new Set(rows.map(r => r.action).filter(Boolean))]
    .sort((a, b) => actionLabel(a).localeCompare(actionLabel(b))), [rows]);

  const shown = rows.filter(r => {
    if (actor !== 'ALL' && r.actor_emp_id !== actor) return false;
    if (action !== 'ALL' && r.action !== action) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.actor_name, r.actor_emp_id, r.target_name, r.target_emp_id, actionLabel(r.action), recordOf(r), fmtDetails(r.details)]
      .some(v => (v ?? '').toString().toLowerCase().includes(q));
  });

  function exportCSV() {
    const headers = ['When', 'Who', 'Who ID', 'Who Role', 'Action', 'Employee', 'Employee ID', 'Record', 'Details'];
    dlCSV(headers, shown.map(r => ({
      'When':        r.created_at ? new Date(r.created_at).toLocaleString() : '',
      'Who':         r.actor_name ?? '',
      'Who ID':      r.actor_emp_id ?? '',
      'Who Role':    r.actor_role ?? '',
      'Action':      actionLabel(r.action),
      'Employee':    r.target_name ?? '',
      'Employee ID': r.target_emp_id ?? '',
      'Record':      recordOf(r),
      'Details':     fmtDetails(r.details),
    })), `audit-log-${from}-to-${to}.csv`);
  }

  if (!allowed) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
        You don’t have access to the Audit Log. Ask an admin if you need it.
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Audit Log</div>
          <div className="page-subtitle">Who did what, when, and on which record. Read-only.</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="row text-sm text-muted" style={{ gap: 4 }}>
              From <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={{ maxWidth: 150 }} />
            </label>
            <label className="row text-sm text-muted" style={{ gap: 4 }}>
              To <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={{ maxWidth: 150 }} />
            </label>
            <select value={actor} onChange={e => setActor(e.target.value)} style={{ maxWidth: 180 }}>
              <option value="ALL">Everyone</option>
              {actors.map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
            </select>
            <select value={action} onChange={e => setAction(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="ALL">All actions</option>
              {actions.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </select>
            <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 160 }} />
          </div>
          <button className="btn-sm" onClick={exportCSV} disabled={!shown.length}>⬇ Export CSV</button>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 24 }}>Loading…</div>}
        {!loading && error && <div style={{ textAlign: 'center', padding: 24, color: 'var(--danger)' }}>{error}</div>}
        {!loading && !error && shown.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No activity found for these filters.</div>
        )}
        {!loading && !error && shown.length > 0 && (
          <>
            <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
              {shown.length.toLocaleString()} entr{shown.length === 1 ? 'y' : 'ies'}
              {rows.length >= ROW_LIMIT && ` · showing the latest ${ROW_LIMIT.toLocaleString()} — narrow the dates to see older entries`}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Employee</th>
                    <th>Record</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.id ?? i}>
                      <td className="text-sm" style={{ whiteSpace: 'nowrap' }}>{fmtWhen(r.created_at)}</td>
                      <td>
                        <div>{r.actor_name ?? r.actor_emp_id ?? '—'}</div>
                        <div className="text-sm text-muted">{[r.actor_emp_id, r.actor_role].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td><span className="badge badge-blue">{actionLabel(r.action)}</span></td>
                      <td>{r.target_name || r.target_emp_id ? `${r.target_name ?? ''}${r.target_emp_id ? ` (${r.target_emp_id})` : ''}` : '—'}</td>
                      <td className="text-sm">{recordOf(r) || '—'}</td>
                      <td className="text-sm text-muted" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{fmtDetails(r.details) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
