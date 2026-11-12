import { useState, useEffect, useRef } from 'react';
import { findIdentifiers, suggestCodes, cleanCode, MAX_TEXT, saveCodingResult, loadCodingStats } from '../../lib/codingAssistant';
import { hasAccess } from '../../lib/access';
import { checkCodes } from '../../lib/codingRules';
import { icdDot, icdLatestYear } from '../../lib/icd10';
import { logAudit } from '../../lib/audit';
import CopyButton from '../../components/shared/CopyButton';
import AiTestingBanner from '../../components/shared/AiTestingBanner';

/**
 * 🧠 Coding Assistant – Phase A (PO 2026-11-11). Diagnosis statements in → AI suggests ICD-10-CM codes (text only, after a
 * browser check for patient identifiers) → rules check them against the Master Library (valid / needs more digits / not
 * valid / Excludes1 conflict / sequencing) → the coder edits the ordered list and copies it. The pasted text lives only in
 * this page's memory: never saved, never sent anywhere except the checked text to the AI, never logged.
 */
const BADGE = {
  valid: ['badge-green', 'Valid'], more_digits: ['badge-yellow', 'Needs more digits'], invalid: ['badge-red', 'Not valid'],
};

export default function CodingAssistant({ user }) {
  const [text, setText] = useState('');
  const [ack, setAck] = useState(false);
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [items, setItems] = useState([]);        // [{ code, role, reason, phrase, source }] in the coder's order (codes can always be typed in)
  const [checked, setChecked] = useState(null);  // { rows, moved }
  const [ai, setAi] = useState([]);              // the AI's codes (for the save in Stage 2)
  const [addCode, setAddCode] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [fy, setFy] = useState(null);
  const [statsKey, setStatsKey] = useState(0);
  useEffect(() => { let alive = true; icdLatestYear().then(y => alive && setFy(y)); return () => { alive = false; }; }, []);
  const run = useRef(0);

  // forget everything when signing out / switching company
  useEffect(() => {
    const wipe = () => { setText(''); setItems([]); setChecked(null); setAi([]); };
    window.addEventListener('helix:signed-out', wipe);
    return () => window.removeEventListener('helix:signed-out', wipe);
  }, []);

  // rules re-run whenever the list changes
  useEffect(() => {
    const n = ++run.current;
    const t = setTimeout(async () => {
      const r = await checkCodes(items);
      if (n === run.current) setChecked(r);
    }, 200);
    return () => clearTimeout(t);
  }, [items]);

  async function suggest() {
    setErr(''); setSaved('');
    const f = findIdentifiers(text);
    setFound(f);
    if (f.length) return;
    if (!ack) { setErr('Tick “No patient identifiers in this text” first.'); return; }
    setBusy('Asking the AI for codes…');
    try {
      const codes = await suggestCodes(text, user);
      if (!codes.length) { setErr('The AI found no codes in these statements — code them by hand below.'); setItems([]); setAi([]); }
      else { setAi(codes.map(c => c.code)); setItems(codes.map(c => ({ ...c, source: 'ai' }))); }
    } catch (e) { setErr(e.message); }
    setBusy('');
  }

  const rows = checked?.rows ?? [];
  const setOrder = list => setItems(list.map((r, i) => ({ code: r.code, role: i === 0 ? 'primary' : 'secondary', reason: r.reason, phrase: r.phrase, source: r.source })));
  const replace = (code, next) => setItems(items.map(i => (i.code === code ? { ...i, code: cleanCode(next), source: i.source === 'ai' ? 'ai_edited' : i.source } : i)));
  const remove = code => setOrder(rows.filter(r => r.code !== code));
  const move = (code, d) => {
    const list = [...rows];
    const i = list.findIndex(r => r.code === code);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
  };
  function add() {
    const c = cleanCode(addCode);
    if (!c || items.some(i => i.code === c)) { setAddCode(''); return; }
    setItems([...items, { code: c, role: items.length ? 'secondary' : 'primary', reason: '', phrase: '', source: 'coder' }]);
    setAddCode('');
  }
  const final = rows.map(r => icdDot(r.code)).join(', ');
  async function save() {
    setSaving(true); setErr('');
    const r = await saveCodingResult({ user, rows, ai, fy });
    setSaving(false);
    if (r.error) { setErr(r.error); return; }
    setText(''); setAck(false); setFound([]); setItems([]); setChecked(null); setAi([]);
    setSaved(`Saved: ${final}`); setStatsKey(k => k + 1);
  }
  const counts = rows.reduce((t, r) => { t[r.status] = (t[r.status] ?? 0) + 1; if (r.conflicts.length) t.conflict++; return t; }, { conflict: 0 });
  function clearAll() {
    if (rows.length) logAudit({ actor: user, action: 'coding_assistant_done', entityType: 'coding_assistant',
      details: { ai_codes: ai.length, final_codes: rows.length, kept: rows.filter(r => ai.includes(r.code)).length } });
    setText(''); setAck(false); setFound([]); setItems([]); setChecked(null); setAi([]); setErr('');
  }

  return (
    <div className="ca-page">
      <AiTestingBanner />
      <div className="ca-banner" role="alert">
        🔒 <strong>Diagnosis statements only.</strong> Do not paste names, DOB, MBI / member ID, MRN or addresses.
        The text is checked here first, never saved, and only the diagnosis wording is sent to the AI.
      </div>

      <div className="card mb-16">
        <label className="ocd-field" style={{ marginBottom: 6 }}>
          <span className="bold">Diagnosis statements</span>
          <textarea rows={6} value={text} maxLength={MAX_TEXT} onChange={e => { setText(e.target.value); setFound([]); }}
            placeholder={'e.g.\nAcute on chronic systolic CHF. Hypertensive heart and chronic kidney disease, CKD stage 3b.\nType 2 diabetes with hyperglycemia, on insulin. Aftercare for left hip fracture.'}
            aria-label="Diagnosis statements" autoComplete="off" spellCheck={false} />
        </label>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="omp-check" style={{ padding: 0 }}>
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            <span className="text-sm">No patient identifiers in this text</span>
          </label>
          <span className="text-sm text-muted">{text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()}</span>
          <span style={{ marginLeft: 'auto' }} className="row">
            <button type="button" className="btn-sm" onClick={clearAll} disabled={!!busy}>Clear</button>
            <button type="button" className="btn-primary" onClick={suggest} disabled={!!busy || !text.trim()}>{busy ? 'Working…' : '✨ Suggest codes'}</button>
          </span>
        </div>
        {found.length > 0 && (
          <div className="ca-found" role="alert">
            <strong>Not sent — remove these first:</strong>
            <ul>{found.map((f, i) => <li key={i}>{f.what}: <mark>{f.match}</mark></li>)}</ul>
          </div>
        )}
        {busy && <div className="loading-row"><div className="spinner" /> {busy}</div>}
        {err && <p className="ot-err" role="alert">{err}</p>}
      </div>

      {(
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <strong>Codes in order</strong>
            {checked && <span className="text-sm text-muted">{counts.valid ?? 0} valid · {counts.more_digits ?? 0} need more digits · {counts.invalid ?? 0} not valid · {counts.conflict} conflict{counts.conflict === 1 ? '' : 's'}</span>}
            {checked?.moved && <span className="badge badge-blue" title="Code first / Use additional code rules changed the order">Order adjusted</span>}
            <span style={{ marginLeft: 'auto' }} className="row">
              {final && <CopyButton value={final} label="Copy codes" />}
              {rows.length > 0 && <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving || !checked}
                title="Saves the codes and counts for QA stats — never the text">{saving ? 'Saving…' : '💾 Save final list'}</button>}
            </span>
          </div>
          {!checked && items.length > 0 && <div className="loading-row"><div className="spinner" /> Checking the codes…</div>}
          {saved && rows.length === 0 && <p className="text-sm" role="status">✓ {saved} — recorded for QA stats with your name (codes only). The text was cleared.</p>}
          {rows.length === 0 && <p className="text-sm text-muted">No codes yet — let the AI suggest them above, or type them in below.</p>}
          {rows.map((r, i) => (
            <div key={r.code} className={`ca-row ca-${r.status}${r.conflicts.length ? ' ca-conflict' : ''}`}>
              <div className="ca-row-h">
                <span className="ca-n">{i + 1}</span>
                <input className="ca-code" defaultValue={icdDot(r.code)} key={r.code} aria-label={`Code ${i + 1}`}
                  onBlur={e => { if (cleanCode(e.target.value) !== r.code) replace(r.code, e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                <span className={`badge ${BADGE[r.status][0]}`}>{r.needs7th ? 'Needs 7th character' : BADGE[r.status][1]}</span>
                {r.conflicts.length > 0 && <span className="badge badge-red">Conflict</span>}
                {r.seq.length > 0 && <span className="badge badge-blue">Sequencing note</span>}
                {i === 0 && <span className="badge badge-purple">Primary</span>}
                {r.source === 'coder' && <span className="text-sm text-muted">added by you</span>}
                <span className="ca-tools">
                  <button type="button" className="btn-sm" onClick={() => move(r.code, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button type="button" className="btn-sm" onClick={() => move(r.code, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
                  <button type="button" className="btn-sm" onClick={() => remove(r.code)} aria-label="Remove">✕</button>
                </span>
              </div>
              {r.desc && <div className="ca-desc">{r.desc}</div>}
              {r.why && <div className="text-sm">{r.why}</div>}
              {r.phrase && <div className="text-sm text-muted">From: “{r.phrase}”{r.reason ? ` — ${r.reason}` : ''}</div>}
              {r.seventh.length > 0 && (
                <div className="text-sm">7th character: {r.seventh.map(s => <span key={s.char} className="ca-7"><b>{s.char}</b> {s.meaning}</span>)}</div>
              )}
              {r.children.length > 0 && (
                <div className="ca-kids">
                  {r.children.slice(0, 30).map(k => (
                    <button key={k.code} type="button" className="icd-kid" onClick={() => replace(r.code, k.code)} title="Use this code">
                      <b>{icdDot(k.code)}</b> {k.long_description || k.description}{k.billable === false ? ' (needs more digits)' : ''}
                    </button>
                  ))}
                </div>
              )}
              {r.conflicts.map(c => (
                <div key={c.with} className="text-sm ca-bad">Excludes1 with {icdDot(c.with)} — these can’t be coded together (note on {icdDot(c.from)}: {c.note}).</div>
              ))}
              {r.seq.map((s, j) => <div key={j} className="text-sm ca-seq">{s.replace(/\b([A-TV-Z]\d[0-9A-Z]{1,5})\b/g, m => icdDot(m))}</div>)}
              {r.hints.slice(0, 2).map((h, j) => <div key={j} className="text-sm text-muted">{h}</div>)}
            </div>
          ))}
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input type="text" value={addCode} onChange={e => setAddCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="Add a code, e.g. Z79.4" aria-label="Add a code" style={{ maxWidth: 200 }} />
            <button type="button" className="btn-sm" onClick={add} disabled={!addCode.trim()}>+ Add</button>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: 0 }}>
            Suggestions only — the coder decides. Check each code against the record and the Official Guidelines (SOP Library → Coding).
          </p>
        </div>
      )}
      {hasAccess(user, 'qa_audit') && <CodingStats key={statsKey} />}
      {user?.role === 'admin' && <SelfCheck />}
    </div>
  );
}

/** QA stats (supervisors and up): lists saved per coder this week / month, share of AI codes kept, AI codes most corrected. */
function CodingStats() {
  const [st, setSt] = useState(undefined);
  useEffect(() => { let alive = true; loadCodingStats().then(x => alive && setSt(x)); return () => { alive = false; }; }, []);
  if (st === null) return <div className="card text-sm text-muted">QA stats need the Coding Assistant database update (migration 56).</div>;
  if (!st) return null;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const table = (title, list) => (
    <div style={{ flex: '1 1 320px', minWidth: 0 }}>
      <div className="bold" style={{ marginBottom: 4 }}>{title}</div>
      {list.length === 0 ? <div className="text-sm text-muted">No saved lists yet.</div> : (
        <div className="table-wrap"><table className="ocd-table">
          <thead><tr><th>Coder</th><th>Lists</th><th>Codes</th><th>AI codes kept</th><th>Lists with problems</th></tr></thead>
          <tbody>{list.map(p => <tr key={p.emp_id}><td>{p.name}</td><td>{p.lists}</td><td>{p.codes}</td><td>{pct(p.kept, p.ai)}</td><td>{p.problems}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
  return (
    <div className="card mb-16">
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}><strong>QA stats</strong><span className="text-sm text-muted">saved final lists — codes only</span></div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {table(`This week (from ${st.weekLabel})`, st.week)}
        {table(`This month (from ${st.monthLabel})`, st.month)}
      </div>
      {st.corrected.length > 0 && (
        <div className="text-sm" style={{ marginTop: 8 }}>AI codes most often changed or removed: {st.corrected.map(([c, n]) => <span key={c} className="ca-7"><b>{icdDot(c)}</b> ×{n}</span>)}</div>
      )}
    </div>
  );
}

/**
 * Admin self-check (PO 2026-11-11): known cases run against the LIVE Master Library ICD-10-CM data and the identifier check,
 * e.g. after a new fiscal year is imported. Made-up text only; nothing is saved or sent anywhere.
 */
const SELF_CHECKS = [
  ['I11.0 goes before I50.9 (Code first / Use additional code)', async () => (await checkCodes([{ code: 'I509' }, { code: 'I110' }])).rows.map(r => r.code).join(',') === 'I110,I509'],
  ['S72.001 needs a 7th character', async () => { const [r] = (await checkCodes([{ code: 'S72001' }])).rows; return r.status === 'more_digits' && r.needs7th && r.children.some(k => k.code === 'S72001A'); }],
  ['E11.65 + E10.9 is an Excludes1 conflict', async () => (await checkCodes([{ code: 'E1165' }, { code: 'E109' }])).rows.every(r => r.conflicts.length > 0)],
  ['I50 is a header with child codes', async () => { const [r] = (await checkCodes([{ code: 'I50' }])).rows; return r.status === 'more_digits' && r.children.length > 0; }],
  ['I50.9 is valid', async () => (await checkCodes([{ code: 'I509' }])).rows[0]?.status === 'valid'],
  ['ZZ99 is not valid', async () => (await checkCodes([{ code: 'ZZ99' }])).rows[0]?.status === 'invalid'],
  ['Made-up MBI / DOB / phone are blocked', async () => findIdentifiers('MBI 1EG4-TE5-MK73 DOB 03/14/1938 (214) 555-0182').length >= 3],
  ['Clinical wording is not blocked', async () => findIdentifiers('MS exacerbation, Stage 2 ulcer, BP 140/90, CVA 2019, S72.001A').length === 0],
];
function SelfCheck() {
  const [res, setRes] = useState(null);
  async function runAll() {
    setRes('running');
    const out = [];
    for (const [name, fn] of SELF_CHECKS) {
      let ok;
      try { ok = await fn(); } catch { ok = false; }
      out.push({ name, ok });
    }
    setRes(out);
  }
  return (
    <div className="card mb-16">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Self-check</strong>
        <span className="text-sm text-muted">admins — known cases against the live ICD-10-CM data (run after each yearly import)</span>
        <button type="button" className="btn-sm" style={{ marginLeft: 'auto' }} onClick={runAll} disabled={res === 'running'}>{res === 'running' ? 'Running…' : 'Run self-check'}</button>
      </div>
      {Array.isArray(res) && (
        <ul className="ca-checks">
          {res.map(r => <li key={r.name} className={r.ok ? 'ok' : 'bad'}>{r.ok ? '✓' : '✗'} {r.name}</li>)}
        </ul>
      )}
      {Array.isArray(res) && <div className="text-sm">{res.filter(r => r.ok).length} of {res.length} passed.</div>}
    </div>
  );
}
