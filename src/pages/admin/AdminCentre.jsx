import { useState, useEffect } from 'react';
import { S, db, getActiveCompany } from '../../lib/supabase';
import { loadCompanyRow, loadHomeFeatures } from '../../lib/company';
import { ALL_FEATURES, isFeatureOn } from '../../lib/companyFeatures';
import { FEATURES, grantsOf } from '../../lib/access';
import { aiKeyStatus } from '../../lib/ai';
import { actionLabel } from '../../lib/auditLabels';
import { setRecord } from '../../lib/navigate';
import NavIcon from '../../components/ui/NavIcon';

/**
 * Admin Centre (PO 2026-11-09): one place for a company admin's tools. Each card sums up an area and opens the page
 * that manages it; the old pages (Team, Settings, Clients & Payers, Audit Log) keep working as before.
 */
const ROLE_ORDER = [['admin', 'Admins'], ['manager', 'Managers'], ['supervisor', 'Supervisors'], ['employee', 'Employees']];
const fmt = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const featureLabel = Object.fromEntries(FEATURES.map(f => [f.key, f.label]));

function Card({ icon, title, children, actions }) {
  return (
    <section className="card fg-card ac-card" aria-label={title}>
      <div className="ac-head">
        <span className="ac-icon" aria-hidden="true"><NavIcon icon={icon} size={18} /></span>
        <h2 className="ac-title">{title}</h2>
      </div>
      <div className="ac-body">{children}</div>
      {actions && <div className="ac-actions">{actions}</div>}
    </section>
  );
}

export default function AdminCentre({ tabs = [], onOpenTab }) {
  const [users, setUsers] = useState(undefined);
  const [procs, setProcs] = useState(undefined);
  const [targets, setTargets] = useState(undefined);
  const [features, setFeatures] = useState(undefined);
  const [ai, setAi] = useState(undefined);
  const [audit, setAudit] = useState(undefined);

  useEffect(() => {
    let alive = true;
    const company = getActiveCompany();
    Promise.all([
      S.get('users'),
      S.get('processes'),
      S.get('task_configs'),
      company?.prefix ? loadCompanyRow(company.code).then(r => r?.features ?? {}) : loadHomeFeatures(),
      aiKeyStatus(),
      db('audit_log').select('created_at,actor_name,action,target_name').order('created_at', { ascending: false }).limit(5),
    ]).then(([u, p, t, f, k, a]) => {
      if (!alive) return;
      setUsers(u ?? null); setProcs(p ?? null); setTargets(t ?? null); setFeatures(f ?? {}); setAi(k); setAudit(a.error ? null : a.data);
    }, () => {});
    return () => { alive = false; };
  }, []);

  const canOpen = id => tabs.some(t => t.id === id);
  const open = (id, record) => { if (record) setRecord(id, record); onOpenTab?.(id); };
  const openBtn = ({ id, label, record, primary = false }) => (canOpen(id)
    ? <button type="button" className={`btn-sm${primary ? ' btn-primary' : ''}`} onClick={() => open(id, record)}>{label}</button>
    : <span className="text-sm text-muted" title="This page is switched off for your company, or needs an admin">{label} — not available</span>);

  const active = (users ?? []).filter(u => u.active !== false);
  const off = (users ?? []).filter(u => u.active === false);
  const withGrants = (users ?? []).filter(u => Object.values(grantsOf(u)).some(Boolean));
  const offPages = ALL_FEATURES.filter(f => !isFeatureOn(features, f.key));
  const activeProcs = (procs ?? []).filter(p => p.active !== false);
  const loading = <div className="loading-row"><div className="spinner" /> Loading…</div>;

  return (
    <div className="fg-page">
      <div className="fg-bar">
        <div className="fg-filters">
          <span className="fg-date">Your company’s admin tools in one place. Each card opens the page that manages it.</span>
        </div>
      </div>

      <div className="ac-grid">
        <Card icon="users" title="Users & roles" actions={openBtn({ id: 'team', label: 'Open Team', primary: true })}>
          {users === undefined ? loading : users === null ? <p className="text-sm">Couldn’t load users.</p> : (
            <>
              <div className="ac-stats">
                {ROLE_ORDER.map(([r, l]) => (
                  <div key={r} className="oc-co-stat"><div className="oc-co-stat-l">{l}</div><div className="bold">{active.filter(u => (u.role ?? 'employee') === r).length}</div></div>
                ))}
              </div>
              <p className="text-sm text-muted">{active.length} active · {off.length} switched off. Add people, change roles, reset passwords.</p>
            </>
          )}
        </Card>

        <Card icon="shield" title="Access & permissions" actions={openBtn({ id: 'team', label: 'Manage access on Team' })}>
          {users === undefined ? loading : (
            <>
              <p className="text-sm" style={{ marginTop: 0 }}>
                <strong>{withGrants.length}</strong> {withGrants.length === 1 ? 'person has' : 'people have'} extra access beyond their role.
              </p>
              {withGrants.length > 0 && (
                <ul className="ac-list">
                  {withGrants.slice(0, 5).map(u => (
                    <li key={u.emp_id}><span className="bold">{u.name ?? u.emp_id}</span> <span className="text-muted">· {Object.keys(grantsOf(u)).filter(k => grantsOf(u)[k]).map(k => featureLabel[k] ?? k).join(', ')}</span></li>
                  ))}
                  {withGrants.length > 5 && <li className="text-muted">… and {withGrants.length - 5} more</li>}
                </ul>
              )}
              <p className="text-sm text-muted">Settings, Team, Clients &amp; Payers and the Audit Log are admin-only; you can give them to someone on the Team page.</p>
            </>
          )}
        </Card>

        <Card icon="trend" title="Targets & processes" actions={openBtn({ id: 'settings', label: 'Open targets in Settings', record: { section: 'targets' }, primary: true })}>
          {procs === undefined ? loading : (
            <>
              <div className="ac-stats">
                <div className="oc-co-stat"><div className="oc-co-stat-l">Processes</div><div className="bold">{procs === null ? '—' : activeProcs.length}</div></div>
                <div className="oc-co-stat"><div className="oc-co-stat-l">Saved task targets</div><div className="bold">{targets === null ? '—' : (targets?.length ?? 0)}</div></div>
              </div>
              {activeProcs.length > 0 && <p className="text-sm text-muted">{activeProcs.map(p => p.name).join(' · ')}</p>}
              <p className="text-sm text-muted">Productivity targets per task, and shift timing.</p>
            </>
          )}
        </Card>

        <Card icon="grid" title="Pages on/off">
          {features === undefined ? loading : (
            <>
              <p className="text-sm" style={{ marginTop: 0 }}>
                <strong>{ALL_FEATURES.length - offPages.length}</strong> of {ALL_FEATURES.length} optional pages are switched on for your company.
              </p>
              {offPages.length > 0 && <p className="text-sm"><span className="text-muted">Switched off:</span> {offPages.map(f => f.label).join(' · ')}</p>}
              <p className="text-sm text-muted">Set by Helix Hub for your plan — contact us to switch a page on or off.</p>
            </>
          )}
        </Card>

        <Card icon="file" title="Company data imports">
          <ul className="ac-links">
            <li>{openBtn({ id: 'wb_payers', label: 'Payer Directory' })} <span className="text-sm text-muted">Starter file, Claim.MD list or Excel — use “Import from Excel” there</span></li>
            <li>{openBtn({ id: 'wb_denials', label: 'Denial codes' })} <span className="text-sm text-muted">official CARC / RARC list or Excel</span></li>
            <li>{openBtn({ id: 'wb_artools', label: 'Code lists', record: { tool: 'codes' } })} <span className="text-sm text-muted">Revenue, HIPPS, ICD-10 — “Import list”</span></li>
            <li>{openBtn({ id: 'dashboard', label: 'Keka attendance' })} <span className="text-sm text-muted">“Import Keka File”</span></li>
            <li>{openBtn({ id: 'masters', label: 'Clients & Payers' })} <span className="text-sm text-muted">your clients and payer list</span></li>
          </ul>
        </Card>

        <Card icon="bot" title="AI & integrations" actions={openBtn({ id: 'settings', label: 'Open AI key in Settings', record: { section: 'ai' }, primary: true })}>
          {ai === undefined || features === undefined ? loading : (
            <ul className="ac-list">
              <li>AI features: <span className={`badge ${isFeatureOn(features, 'ai') ? 'badge-green' : 'badge-gray'}`}>{isFeatureOn(features, 'ai') ? 'On' : 'Switched off by Helix Hub'}</span></li>
              <li>AI key: {ai?.saved ? <span className="badge badge-green">Saved (ending …{ai.ending})</span> : <span className="badge badge-yellow">Not saved</span>}</li>
              <li>Keka attendance: <span className={`badge ${isFeatureOn(features, 'dashboard') ? 'badge-green' : 'badge-gray'}`}>{isFeatureOn(features, 'dashboard') ? 'Page on' : 'Page off'}</span></li>
            </ul>
          )}
        </Card>

        <Card icon="scroll" title="Audit log" actions={openBtn({ id: 'auditlog', label: 'Open Audit Log', primary: true })}>
          {audit === undefined ? loading : audit === null ? <p className="text-sm">Couldn’t load the audit log.</p> : audit.length === 0 ? <p className="text-sm text-muted">Nothing logged yet.</p> : (
            <ul className="ac-list">
              {audit.map((a, i) => (
                <li key={i}><span className="text-muted">{fmt(a.created_at)}</span> · <span className="bold">{a.actor_name ?? '—'}</span> · {actionLabel(a.action)}{a.target_name ? ` · ${a.target_name}` : ''}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
