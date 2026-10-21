import { useState, useMemo } from 'react';
import { PORTAL_GROUPS, checkPortal, cleanUrl, directoryPortal, addPortal, editPortal } from '../../lib/portals';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * Add / edit one launchpad link (roadmap 6.6, “Manage portal links”). Software comes from the SOP Library, payers from
 * the Payer Directory; an empty link uses their standard login link. There is no password field — on purpose.
 */
export default function PortalEditor({ row, clientId, data, ctx, user, nextOrder, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    client_id: row ? row.client_id : clientId,
    kind: row?.kind ?? 'software',
    software_id: row?.software_id ?? null,
    payer_id: row?.payer_id ?? null,
    label: row?.label ?? '',
    url: row?.url ?? '',
    access_note: row?.access_note ?? '',
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const software = useMemo(() => [...data.software].sort((a, b) => a.name.localeCompare(b.name)), [data.software]);
  const payer = form.payer_id ? ctx.payers.find(p => p.id === form.payer_id) : null;
  const standard = form.kind === 'software' ? software.find(s => s.id === form.software_id)?.portal_url
    : form.kind === 'payer' && form.payer_id ? directoryPortal(data, form.payer_id)?.portal_url : null;

  async function save() {
    const problem = checkPortal(form);
    if (problem) return setError(problem);
    if (form.kind !== 'custom' && !form.url.trim() && !cleanUrl(standard)) {
      return setError('There is no standard login link for this one yet — type the link.');
    }
    setSaving(true);
    const ok = row ? await editPortal(row, form, user) : await addPortal(form, user, nextOrder);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title={row ? 'Edit portal link' : 'Add a portal link'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="field"><label>Shown for</label>
          <select value={form.client_id == null ? '' : String(form.client_id)} onChange={e => set('client_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">All clients</option>
            {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Type</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {PORTAL_GROUPS.map(g => (
              <button key={g.value} type="button" className={form.kind === g.value ? 'btn-primary' : 'btn-sm'}
                aria-pressed={form.kind === g.value} onClick={() => set('kind', g.value)}>{g.icon} {g.label}</button>
            ))}
          </div>
        </div>

        {form.kind === 'software' && (
          <div className="field"><label>Software (from the SOP Library)</label>
            {software.length === 0
              ? <p className="text-sm text-muted" style={{ margin: 0 }}>No software in the SOP Library yet — add it there first, or use “Other links”.</p>
              : (
                <select value={form.software_id ?? ''} onChange={e => set('software_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Choose —</option>
                  {software.map(s => <option key={s.id} value={s.id}>{s.name}{s.vendor ? ` — ${s.vendor}` : ''}</option>)}
                </select>
              )}
          </div>
        )}
        {form.kind === 'payer' && (
          <div className="field"><label>Payer</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set('payer_id', null)}>✕</button></div>
              : <PayerSearch payers={ctx.payers} onSelect={p => set('payer_id', p.id)} />}
          </div>
        )}

        <div className="field"><label>{form.kind === 'custom' ? 'Name' : 'Name shown (optional)'}</label>
          <input type="text" value={form.label} onChange={e => set('label', e.target.value)}
            placeholder={form.kind === 'custom' ? 'e.g. Client fax portal' : 'Leave empty to use the software / payer name'} />
        </div>
        <div className="field"><label>{form.kind === 'custom' ? 'Link' : 'Link for this client (optional)'}</label>
          <input type="url" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://…" />
          {form.kind !== 'custom' && (
            <span className="text-sm text-muted">
              {standard ? <>Empty = standard link: {standard}</> : 'No standard link yet — type one here.'}
            </span>
          )}
        </div>
        <div className="field"><label>How to get access (optional)</label>
          <textarea rows={2} value={form.access_note} onChange={e => set('access_note', e.target.value)}
            placeholder="e.g. Ask your supervisor for a login. MFA code goes to the team phone." />
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 Never put user names, passwords or PINs here — only the login page and how to get access.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save' : 'Add link'}</button>
        </div>
      </div>
    </Modal>
  );
}
