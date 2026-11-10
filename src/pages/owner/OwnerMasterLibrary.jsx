import { useState, useEffect, useCallback } from 'react';
import { masterStatus, masterHistory, exportMasterArea } from '../../lib/owner';
import { alertDialog } from '../../components/shared/Dialog';
import Modal from '../../components/shared/Modal';
import NavIcon from '../../components/ui/NavIcon';
import { setRecord } from '../../lib/navigate';

/**
 * Owner Command Center → Master Library (PO 2026-11-10). One shared library every company reads (the master copy
 * workspace, co_master__…). Each area: Edit / Import (opens the master on the normal page), Export to Excel, History.
 */
const AREAS = [
  { id: 'payers', title: 'Payers', icon: 'bookmark', tab: 'wb_payers', importRecord: { import: true },
    counts: [['payers', 'Payers'], ['payer_ids', 'Payer IDs'], ['payer_contacts', 'Contacts'], ['payer_limits', 'Filing limits'], ['payer_notes', 'Notes']],
    hint: 'Payers with plans, payer IDs, contacts, filing limits, forms and notes. Import: Starter file, Claim.MD list or Excel.' },
  { id: 'denials', title: 'Denials', icon: 'shield', tab: 'wb_denials', importRecord: { import: true },
    counts: [['denial_codes', 'Codes'], ['denial_steps', 'Steps']],
    hint: 'CARC / RARC / group codes with plain-English reasons and the common + payer steps. Import: official list or Excel.' },
  { id: 'sops', title: 'SOPs', icon: 'book', tab: 'wb_sops',
    counts: [['sop_categories', 'Categories'], ['sop_software', 'Software'], ['sop_tasks', 'Tasks'], ['sops', 'SOPs']],
    hint: 'Categories → software → tasks → SOPs, with versions, screenshots and videos.' },
  { id: 'codes', title: 'Code lists', icon: 'calc', tab: 'wb_artools', editRecord: { tool: 'codes' }, importRecord: { tool: 'codes' },
    counts: [['ref_codes', 'Codes']],
    hint: 'Revenue, HIPPS and ICD-10 codes. Import: “Import list” on Code lookup.' },
];
const ACTIONS = { add: ['Added', 'badge-green'], change: ['Changed', 'badge-blue'], remove: ['Removed', 'badge-red'] };
const fmt = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function OwnerMasterLibrary({ owner, onOpen }) {
  const [st, setSt] = useState(undefined);       // undefined = loading · null = not set up
  const [busy, setBusy] = useState('');
  const [history, setHistory] = useState(null);  // { area, rows }

  const load = useCallback(async () => {
    const r = await masterStatus(owner);
    setSt(r.error || !r.data?.exists ? null : r.data);
  }, [owner]);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => alive && load());
    return () => { alive = false; };
  }, [load]);

  const master = st && { name: st.name, code: st.code, prefix: st.prefix, is_master: true };
  const openArea = (a, record) => { if (record) setRecord(a.tab, record); onOpen(master, { startTab: a.tab }); };

  async function doExport(a) {
    setBusy(`export-${a.id}`);
    const r = await exportMasterArea(a.id);
    setBusy('');
    if (r.error) await alertDialog({ title: 'Could not export', message: r.error, tone: 'warning' });
  }

  async function showHistory(a) {
    setBusy(`history-${a.id}`);
    const r = await masterHistory(owner, a.id);
    setBusy('');
    if (r.error) {
      await alertDialog({ title: 'History not available', message: r.error === 'NOT_SET_UP' ? 'Change history needs the Master Library database update (migration 51) first.' : r.error, tone: 'warning' });
      return;
    }
    setHistory({ area: a, rows: r.data ?? [] });
  }

  if (st === undefined) return <div className="card fg-card"><div className="loading-row"><div className="spinner" /> Loading the Master Library…</div></div>;
  if (st === null) return <div className="card fg-card"><p className="text-sm" style={{ margin: 0 }}>The Master Library needs the master copy (migration 47) first.</p></div>;

  return (
    <>
      <div className="fg-bar">
        <div className="fg-filters">
          <span className="fg-date">One library shared by every company — companies read it; only you can change it. Every change is in the history and your owner log.</span>
        </div>
      </div>

      <div className="ac-grid">
        {AREAS.map(a => (
          <section key={a.id} className="card fg-card ac-card" aria-label={a.title}>
            <div className="ac-head">
              <span className="ac-icon" aria-hidden="true"><NavIcon icon={a.icon} size={18} /></span>
              <h2 className="ac-title">{a.title}</h2>
            </div>
            <div className="ac-stats">
              {a.counts.map(([k, l]) => (
                <div key={k} className="oc-co-stat"><div className="oc-co-stat-l">{l}</div><div className="bold">{st.counts?.[k] ?? 0}</div></div>
              ))}
            </div>
            <p className="text-sm text-muted" style={{ margin: 0 }}>{a.hint}</p>
            <div className="ac-actions">
              <button type="button" className="btn-sm btn-primary" onClick={() => openArea(a, a.editRecord)}>Edit</button>
              <button type="button" className="btn-sm" onClick={() => openArea(a, a.importRecord)}>Import</button>
              <button type="button" className="btn-sm" onClick={() => doExport(a)} disabled={!!busy}>{busy === `export-${a.id}` ? 'Exporting…' : 'Export to Excel'}</button>
              <button type="button" className="btn-sm" onClick={() => showHistory(a)} disabled={!!busy}>{busy === `history-${a.id}` ? 'Loading…' : 'History'}</button>
            </div>
          </section>
        ))}
      </div>

      {history && (
        <Modal title={`${history.area.title} — change history`} onClose={() => setHistory(null)} wide>
          {history.rows.length === 0 ? <p className="text-sm text-muted">No changes recorded yet. Changes made from now on are listed here.</p> : (
            <div className="table-wrap" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              <table>
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Fields</th></tr></thead>
                <tbody>
                  {history.rows.map((h, i) => (
                    <tr key={i}>
                      <td className="text-sm">{fmt(h.at)}</td>
                      <td>{h.owner}</td>
                      <td><span className={`badge ${ACTIONS[h.action]?.[1] ?? 'badge-gray'}`}>{ACTIONS[h.action]?.[0] ?? h.action}</span> <span className="text-sm text-muted">{h.tbl.replace(/_/g, ' ')}</span></td>
                      <td>{h.label}</td>
                      <td className="text-sm text-muted">{(h.fields ?? []).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
