import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { DEFAULT_PROJECT, DEF_PROCS } from '../../lib/constants';
import { logAudit } from '../../lib/audit';
import { hasAccess } from '../../lib/access';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const PAYER_TYPES = ['Medicare', 'Medicare Advantage', 'Medicaid', 'Managed Medicaid (MCO)', 'Commercial', 'Workers’ Comp', 'Other'];

const KINDS = {
  clients: {
    table: 'clients', entity: 'client', one: 'Client', many: 'Clients', icon: '🏢',
    blank: { name: '', code: '', project: '', notes: '' },
    summary: r => [r.code, r.project].filter(Boolean).join(' · '),
  },
  payers: {
    table: 'payers', entity: 'payer', one: 'Payer', many: 'Payers', icon: '🏦',
    blank: { name: '', payer_type: '', aliases: '', notes: '' },
    summary: r => [r.payer_type, (r.aliases ?? []).join(', ')].filter(Boolean).join(' · '),
  },
};

const splitAliases = s => [...new Set(s.split(',').map(a => a.trim()).filter(Boolean))];

/** Clients & Payers master lists (roadmap 0.5). Rows are never deleted — only made inactive. */
export default function MasterData({ user }) {
  const [kind, setKind]         = useState('clients');
  const [data, setData]         = useState({ clients: null, payers: null });
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState('active');
  const [form, setForm]         = useState(null);    // { id?, ...fields, error }
  const [saving, setSaving]     = useState(false);
  const allowed = hasAccess(user, 'masters_edit');
  const K = KINDS[kind];

  useEffect(() => { if (allowed) load(); }, [allowed]);

  async function load() {
    setLoading(true);
    const [clients, payers, procs] = await Promise.all([S.get('clients'), S.get('payers'), S.get('processes')]);
    setData({ clients, payers });   // null = table not created yet
    setProjects([...new Set([...(DEF_PROCS.length ? [DEFAULT_PROJECT] : []), ...(procs ?? []).map(p => p.project).filter(Boolean)])]);
    setLoading(false);
  }

  const rows = data[kind];
  const shown = (rows ?? [])
    .filter(r => status === 'all' || (status === 'active' ? r.active !== false : r.active === false))
    .filter(r => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [r.name, r.code, r.project, r.payer_type, ...(r.aliases ?? [])].some(v => (v ?? '').toLowerCase().includes(q));
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  function openAdd() { setForm({ ...K.blank, error: '' }); }
  function openEdit(r) {
    setForm(kind === 'clients'
      ? { id: r.id, name: r.name ?? '', code: r.code ?? '', project: r.project ?? '', notes: r.notes ?? '', error: '' }
      : { id: r.id, name: r.name ?? '', payer_type: r.payer_type ?? '', aliases: (r.aliases ?? []).join(', '), notes: r.notes ?? '', error: '' });
  }
  const setF = patch => setForm(f => ({ ...f, ...patch, error: '' }));

  async function save() {
    const name = form.name.trim();
    if (!name) return setForm(f => ({ ...f, error: `Enter the ${K.one.toLowerCase()} name.` }));
    const dupe = (rows ?? []).find(r => r.id !== form.id && (r.name ?? '').toLowerCase() === name.toLowerCase());
    if (dupe) return setForm(f => ({ ...f, error: `“${dupe.name}” already exists${dupe.active === false ? ' (inactive — reactivate it instead)' : ''}.` }));
    const editing = form.id != null;
    if (!await confirmDialog({ title: editing ? 'Save changes?' : `Add this ${K.one.toLowerCase()}?`, message: name, confirmText: editing ? 'Save Changes' : `Add ${K.one}` })) return;

    const fields = kind === 'clients'
      ? { name, code: form.code.trim().toUpperCase() || null, project: form.project || null, notes: form.notes.trim() || null }
      : { name, payer_type: form.payer_type || null, aliases: splitAliases(form.aliases), notes: form.notes.trim() || null };
    const stamp = { updated_by: user.emp_id, updated_at: new Date().toISOString() };
    setSaving(true);
    const result = editing
      ? await S.update(K.table, { ...fields, ...stamp }, { id: form.id })
      : await S.set(K.table, { ...fields, ...stamp, created_by: user.emp_id, active: true });
    setSaving(false);
    if (!result?.length) return setForm(f => ({ ...f, error: 'Could not save. The name may already exist — please try again.' }));
    logAudit({
      actor: user, action: `${editing ? 'edit' : 'create'}_${K.entity}`,
      entityType: K.entity, entityId: result[0].id, details: { name },
    });
    setForm(null);
    await load();
  }

  async function toggleActive(r) {
    const deactivating = r.active !== false;
    if (!await confirmDialog(deactivating
      ? { title: `Make ${r.name} inactive?`, message: 'It will be hidden from pick lists. Nothing is deleted, and you can reactivate it any time.', tone: 'warning', confirmText: 'Make Inactive' }
      : { title: `Reactivate ${r.name}?`, message: 'It will show in pick lists again.', confirmText: 'Reactivate' })) return;
    const ok = await S.update(K.table, { active: !deactivating, updated_by: user.emp_id, updated_at: new Date().toISOString() }, { id: r.id });
    if (!ok) return;
    logAudit({ actor: user, action: `${deactivating ? 'deactivate' : 'activate'}_${K.entity}`, entityType: K.entity, entityId: r.id, details: { name: r.name } });
    await load();
  }

  if (!allowed) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
        You don’t have access to Clients &amp; Payers. Ask an admin if you need it.
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Clients &amp; Payers</div>
          <div className="page-subtitle">Master lists used across the Workbench. Entries are never deleted — make them inactive instead.</div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.entries(KINDS).map(([k, v]) => (
          <button key={k} className={kind === k ? 'btn-primary' : 'btn-sm'} onClick={() => { setKind(k); setSearch(''); }}>
            {v.icon} {v.many}{data[k] ? ` (${data[k].filter(r => r.active !== false).length})` : ''}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input type="text" placeholder={kind === 'payers' ? 'Search name or alias…' : 'Search name, code, project…'}
              value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 220 }} />
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 120 }}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>
          <button className="btn-primary" onClick={openAdd} disabled={rows == null}>+ Add {K.one}</button>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 24 }}>Loading…</div>}
        {!loading && rows == null && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
            The {K.many.toLowerCase()} table isn’t set up yet. Run supabase/migrations/20261018c_clients_payers.sql in Supabase,
            then “Sync structure” in the Owner Console.
          </div>
        )}
        {!loading && rows != null && shown.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
            {rows.length ? 'Nothing matches these filters.' : `No ${K.many.toLowerCase()} yet — click “+ Add ${K.one}”.`}
          </div>
        )}
        {!loading && shown.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  {kind === 'clients' ? <><th>Code</th><th>Project</th></> : <><th>Type</th><th>Aliases</th></>}
                  <th className="center">Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} style={{ opacity: r.active === false ? 0.55 : undefined }}>
                    <td>
                      <div className="bold">{r.name}</div>
                      {r.notes && <div className="text-sm text-muted">{r.notes}</div>}
                    </td>
                    {kind === 'clients'
                      ? <><td>{r.code || '—'}</td><td>{r.project || '—'}</td></>
                      : <>
                          <td>{r.payer_type || '—'}</td>
                          <td>
                            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                              {(r.aliases ?? []).length ? r.aliases.map(a => <span key={a} className="badge badge-gray">{a}</span>) : '—'}
                            </div>
                          </td>
                        </>}
                    <td className="center">
                      <span className={`badge ${r.active !== false ? 'badge-green' : 'badge-red'}`}>{r.active !== false ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn-sm" onClick={() => openEdit(r)}>Edit</button>
                        <button className="btn-sm" style={{ color: r.active !== false ? 'var(--danger)' : 'var(--success)' }}
                          onClick={() => toggleActive(r)}>
                          {r.active !== false ? 'Make Inactive' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <Modal title={form.id != null ? `Edit ${K.one} — ${form.name || ''}` : `Add ${K.one}`} onClose={() => setForm(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="field">
              <label>{K.one} name</label>
              <input type="text" value={form.name} autoFocus onChange={e => setF({ name: e.target.value })}
                placeholder={kind === 'clients' ? 'e.g. Sunrise Home Health' : 'e.g. Blue Cross Blue Shield of Texas'} />
            </div>
            {kind === 'clients' ? (
              <>
                <div className="field">
                  <label>Short code (optional)</label>
                  <input type="text" value={form.code} onChange={e => setF({ code: e.target.value })} placeholder="e.g. SRHH" />
                </div>
                <div className="field">
                  <label>Project in Helix Hub (optional)</label>
                  <select value={form.project} onChange={e => setF({ project: e.target.value })}>
                    <option value="">— None —</option>
                    {projects.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label>Payer type</label>
                  <select value={form.payer_type} onChange={e => setF({ payer_type: e.target.value })}>
                    <option value="">— Not set —</option>
                    {PAYER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Other names / aliases (comma-separated)</label>
                  <input type="text" value={form.aliases} onChange={e => setF({ aliases: e.target.value })}
                    placeholder="e.g. BCBSTX, Blue Cross Texas" />
                </div>
              </>
            )}
            <div className="field">
              <label>Notes (optional — no patient information)</label>
              <textarea rows={2} value={form.notes} onChange={e => setF({ notes: e.target.value })} />
            </div>
            {form.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{form.error}</p>}
            <div className="form-actions">
              <button className="btn-sm" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : form.id != null ? 'Save Changes' : `Add ${K.one}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
