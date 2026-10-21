import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadPeople } from '../../lib/qa';
import { loadBulletins } from '../../lib/payerUpdates';
import { CATEGORIES, categoryOf, canPost, isLive, forMe, loadBoard, markNoticeRead, setNoticeFlags } from '../../lib/board';
import { openSopLibrary } from '../../lib/sops';
import { setRecord, peekRecord, clearRecord } from '../../lib/navigate';
import { TEAMS } from '../../lib/constants';
import { today } from '../../lib/helpers';
import { confirmDialog } from '../../components/shared/Dialog';
import SopText from './SopText';
import NoticeEditor from './NoticeEditor';

const fmt = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const openTab = id => window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: id }));

/**
 * 📌 Notice Board (roadmap 10.3): lasting notices by category and audience — pinned first, must-read with “✓ I've read
 * this” and read tracking, linked SOP / payer / payer update. Beside the existing Announcements (unchanged).
 */
export default function NoticeBoard({ user }) {
  const poster = canPost(user);
  const [board, setBoard] = useState(undefined);         // undefined = loading, null = not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [people, setPeople] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [category, setCategory] = useState('ALL');
  const [view, setView] = useState('mine');              // mine | all | unread | archive
  const [query, setQuery] = useState('');
  const [focus] = useState(() => peekRecord('wb_board')?.noticeId ?? null);   // 10.1: opened from global search
  const [editing, setEditing] = useState(null);          // { row } — row null = new
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    clearRecord('wb_board');
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadPeople().then(p => { if (alive) setPeople(p); });
    loadBulletins().then(b => {
      if (!alive || !b) return;
      setUpdates(b.filter(x => x.active !== false).flatMap(x => x.updates.map(u => ({ id: u.id, label: `${u.payer_name ?? 'Payer'}: ${u.change_text}`.slice(0, 90) }))));
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    loadBoard().then(b => { if (alive) setBoard(b); });
    return () => { alive = false; };
  }, [reloadKey]);

  const readByMe = n => (board?.reads[n.id] ?? []).includes(user.emp_id);
  const list = useMemo(() => {
    if (!board) return [];
    const q = query.trim().toLowerCase();
    return board.notices.filter(n => {
      if (focus && n.id === focus) return true;
      if (view === 'archive' ? isLive(n) : !isLive(n)) return false;
      if (view !== 'archive' && view !== 'all' && !forMe(n, user)) return false;
      if (view === 'unread' && !(n.must_read && !(board.reads[n.id] ?? []).includes(user.emp_id))) return false;
      return (category === 'ALL' || n.category === category)
        && (!q || [n.title, n.body].some(t => (t ?? '').toLowerCase().includes(q)));
    });
  }, [board, view, category, query, user, focus]);

  /** “AR: 7 / 9 · Auth: 2 / 4” — who has read a must-read notice (posters / managers). */
  function readLine(n) {
    const readers = board.reads[n.id] ?? [];
    const teams = (n.teams ?? []).length ? n.teams : TEAMS;
    return teams.map(t => {
      const members = people.filter(p => p.team === t);
      return members.length ? `${t}: ${members.filter(p => readers.includes(p.emp_id)).length} / ${members.length}` : null;
    }).filter(Boolean).join(' · ');
  }
  function notRead(n) {
    const readers = board.reads[n.id] ?? [];
    return people.filter(p => (!(n.teams ?? []).length || n.teams.includes(p.team)) && !readers.includes(p.emp_id)).map(p => p.name);
  }

  async function run(fn) { setBusy(true); await fn(); setBusy(false); reload(); }
  async function archive(n) {
    if (n.active !== false && !await confirmDialog({ title: 'Archive this notice?', message: 'It leaves the board but is kept in Archive.', confirmText: 'Archive' })) return;
    run(() => setNoticeFlags(n, { active: n.active === false }, user));
  }
  function openPayer(id) { setRecord('wb_payers', { payerId: id }); openTab('wb_payers'); }

  const counts = board ? {
    unread: board.notices.filter(n => isLive(n) && forMe(n, user) && n.must_read && !readByMe(n)).length,
  } : { unread: 0 };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">📌 Notice Board</div>
          <div className="page-subtitle">Process changes, client and payer news, system notices and wins — kept until they no longer apply.</div>
        </div>
        {board && poster && <button className="btn-primary" onClick={() => setEditing({ row: null })}>+ Post a notice</button>}
      </div>

      {board === undefined && <div className="card text-muted">Loading…</div>}
      {board === null && <div className="card text-muted">The Notice Board isn’t set up yet. An admin needs to run the database update (<code>20261021x_notice_board.sql</code>) in Supabase.</div>}

      {board && (
        <>
          <div className="card mb-16">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {[['mine', 'For my team'], ['unread', `Must read — not yet read${counts.unread ? ` (${counts.unread})` : ''}`], ['all', 'Everything'], ['archive', 'Archive']].map(([id, label]) => (
                <button key={id} className={view === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
                <option value="ALL">All categories</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
              <input type="search" style={{ flex: '1 1 200px' }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search notices…" aria-label="Search" />
            </div>
          </div>

          {list.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>{view === 'unread' ? 'You have read every must-read notice. 🎉' : 'No notices here.'}</div>}

          {list.map(n => {
            const cat = categoryOf(n.category);
            const sop = n.sop_id ? ctx.sops.find(s => s.id === n.sop_id) : null;
            const payer = n.payer_id ? ctx.payers.find(p => p.id === n.payer_id) : null;
            const update = n.payer_update_id ? updates.find(u => u.id === n.payer_update_id) : null;
            const client = n.client_id ? ctx.clients.find(c => c.id === n.client_id) : null;
            const mayManage = poster && (['admin', 'manager'].includes(user.role) || n.posted_by === user.emp_id);
            const showReaders = n.must_read && (['admin', 'manager', 'supervisor'].includes(user.role) || n.posted_by === user.emp_id);
            return (
              <div key={n.id} className="card mb-16" style={{ ...(n.pinned ? { borderLeft: '4px solid var(--accent)' } : {}), ...(n.id === focus ? { boxShadow: '0 0 0 2px var(--accent)' } : {}), ...(!isLive(n) ? { opacity: 0.6 } : {}) }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {n.pinned && <span title="Pinned">📌</span>}
                  <span className="bold" style={{ fontSize: 16, flex: '1 1 240px' }}>{n.title}</span>
                  <span className="badge badge-gray">{cat.icon} {cat.label}</span>
                  {n.must_read && (readByMe(n) ? <span className="badge badge-green">✓ Read</span> : <span className="badge badge-red">Must read</span>)}
                </div>
                <div className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>
                  {(n.teams ?? []).length ? n.teams.join(', ') : 'Everyone'}{client ? ` · ${client.name}` : ''} · from {fmt(n.show_from)}{n.show_until ? ` until ${fmt(n.show_until)}` : ''}
                  {' '}· posted by {people.find(p => p.emp_id === n.posted_by)?.name ?? n.posted_by ?? '—'}
                  {n.show_until && n.show_until < today() && ' · expired'}
                  {n.active === false && ' · archived'}
                </div>
                {n.body && <SopText text={n.body} />}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                  {sop && <button className="btn-sm" onClick={() => openSopLibrary(sop.title)}>📚 {sop.title}</button>}
                  {payer && <button className="btn-sm" onClick={() => openPayer(payer.id)}>📇 {payer.name}</button>}
                  {update && <button className="btn-sm" onClick={() => { setRecord('wb_updates', { tab: 'all', query: update.label.split(':')[0] }); openTab('wb_updates'); }}>📰 Payer update</button>}
                  {n.must_read && !readByMe(n) && isLive(n) && forMe(n, user) && (
                    <button className="btn-primary btn-sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => run(() => markNoticeRead(n, user))}>✓ I've read this</button>
                  )}
                </div>
                {showReaders && (
                  <div className="text-sm text-muted" style={{ marginTop: 8 }}>
                    Read: {readLine(n) || '—'}
                    {notRead(n).length > 0 && notRead(n).length <= 25 && <div>Not yet: {notRead(n).join(', ')}</div>}
                  </div>
                )}
                {mayManage && (
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <button className="btn-sm" disabled={busy} onClick={() => setEditing({ row: n })}>✏️ Edit</button>
                    <button className="btn-sm" disabled={busy} onClick={() => run(() => setNoticeFlags(n, { pinned: !n.pinned }, user))}>{n.pinned ? 'Unpin' : '📌 Pin'}</button>
                    <button className="btn-sm" disabled={busy} onClick={() => archive(n)}>{n.active === false ? 'Restore' : 'Archive'}</button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {editing && (
        <NoticeEditor row={editing.row} ctx={ctx} updates={updates} user={user}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}
