import { useState, useEffect } from 'react';
import { listCompanies, loadHomeCompanyInfo, isMasterCompany } from '../lib/company';
import { getActiveCompany } from '../lib/supabase';
import NavIcon from './ui/NavIcon';

/**
 * Owner Command Center (PO 2026-11-09): replaces the purple owner banner inside a company.
 * "Viewing as Owner · [Company ▼] · Back to Command Center" — switching opens the other company as admin (logged like Open).
 */
export default function OwnerCompanyBar({ user, offCount = 0, onSwitch, onBack }) {
  const [list, setList] = useState(null);
  const active = getActiveCompany();
  const current = active?.prefix ?? '';
  const editingMaster = isMasterCompany(active);

  useEffect(() => {
    let alive = true;
    Promise.all([loadHomeCompanyInfo(), listCompanies()]).then(([home, added]) => {
      if (alive) setList([{ ...home, prefix: '', isHome: true, active: true }, ...(added ?? [])]);
    }, () => {});
    return () => { alive = false; };
  }, []);

  const options = [
    ...(editingMaster ? [{ prefix: current, name: 'Master Library', code: active.code, is_master: true }] : []),
    ...(list ?? (editingMaster ? [] : [{ prefix: current, name: user.viewing }])),
  ];

  return (
    <div className={`oc-viewbar${editingMaster ? ' oc-viewbar-master' : ''}`} role="region" aria-label="Owner view">
      <span className="oc-viewbar-badge"><NavIcon icon={editingMaster ? 'database' : 'crown'} size={14} /> {editingMaster ? 'Editing MASTER LIBRARY' : 'Viewing as Owner'}</span>
      <select
        className="oc-viewbar-select"
        aria-label="Switch company"
        value={current}
        disabled={!list}
        onChange={e => { const c = options.find(o => (o.prefix ?? '') === e.target.value); if (c) onSwitch(c); }}
      >
        {options.map(c => (
          <option key={c.prefix || 'home'} value={c.prefix ?? ''}>{c.name}{c.active === false ? ' (paused)' : ''}</option>
        ))}
      </select>
      {user.viewingAs && <span className="oc-viewbar-note">as {user.name ?? user.emp_id} ({user.emp_id}) · actions logged as the owner</span>}
      {editingMaster && <span className="oc-viewbar-note">Shared with every company · every change is recorded in the history and your owner log</span>}
      {!user.viewingAs && !editingMaster && <span className="oc-viewbar-note">full admin access</span>}
      {offCount > 0 && !editingMaster && <span className="oc-viewbar-note">· {offCount} page{offCount === 1 ? '' : 's'} switched off here</span>}
      <button type="button" className="oc-viewbar-back" onClick={onBack}>
        <NavIcon icon="arrowLeft" size={14} /> Back to Command Center
      </button>
    </div>
  );
}
