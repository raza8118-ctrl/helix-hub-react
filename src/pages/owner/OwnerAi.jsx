import { useState, useEffect, useCallback } from 'react';
import { aiConfigGet, aiConfigSave, aiModels, saveCompanySettings, ownerLog, companyAudit, codeOf } from '../../lib/owner';
import { loadHomeFeatures, saveHomeFeatures } from '../../lib/company';
import { isFeatureOn } from '../../lib/companyFeatures';
import { confirmDialog } from '../../components/shared/Dialog';

/**
 * Owner Console → Platform → AI (PO 2026-11-12). Which provider / model every AI feature uses (through the "ai" Edge
 * Function), Testing or Production mode, AI on / off per company, and usage per feature (counts only). The API keys are
 * Supabase secrets — this page never sees them; it only shows whether the provider answered with a model list.
 */
const FEATURE_LABEL = {
  ai_email: 'AI email (Today / Weekly)', ask_helix: 'Ask Helix', auth_checklist: 'Auth checklist', credentialing_checklist: 'Credentialing checklist',
  appeal_wording: 'Appeal AI wording', bulletin_reading: 'Bulletin reading', payer_suggestions: 'Payer suggestions', reports_summary: 'Reports summary',
  coding_assistant: 'Coding Assistant', test: 'Test calls', test_tools: 'Test calls (tools)',
};
const ERR = {
  gemini_production: 'Gemini (Google AI Studio key) is not covered by a BAA — it can only run in Testing mode.',
  baa: 'Production needs “BAA signed with Anthropic” ticked.', model: 'That model name is not valid.', NOT_SET_UP: 'This needs the AI database update (migration 58).',
};

export default function OwnerAi({ owner, rows, onChanged }) {
  const [cfg, setCfg] = useState(undefined);
  const [form, setForm] = useState(null);
  const [models, setModels] = useState(undefined);
  const [homeFeatures, setHomeFeatures] = useState(undefined);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);   // { ok, text }

  const load = useCallback(async () => {
    const [c, m, h] = await Promise.all([aiConfigGet(owner), aiModels(owner), loadHomeFeatures()]);
    setCfg(c.error ? null : c.data);
    if (!c.error) setForm({ provider: c.data.provider, model: c.data.model, mode: c.data.mode, baa: c.data.baa_confirmed });
    setModels(m);
    setHomeFeatures(h ?? {});
    if (c.error) setMsg({ ok: false, text: ERR[c.error] ?? c.error });
  }, [owner]);
  useEffect(() => { let alive = true; Promise.resolve().then(() => alive && load()); return () => { alive = false; }; }, [load]);

  const list = form && Array.isArray(models?.[form.provider]) ? models[form.provider] : null;
  const keyState = p => (models === undefined ? 'checking…' : models?.error ? models.error : models?.[p] === null ? 'secret not set' : models?.[p]?.error ? `key problem: ${models[p].error}` : `✓ key set (${models[p].length} models)`);

  async function save() {
    if (form.mode === 'production' && !await confirmDialog({ title: 'Switch AI to Production?', message: 'Real work data may then be sent to Claude. Only do this with a signed BAA and the ANTHROPIC_API_KEY secret set.', confirmText: 'Switch to Production', tone: 'warning' })) return;
    setBusy('save'); setMsg(null);
    const r = await aiConfigSave(owner, form);
    setBusy('');
    if (r.error || r.data?.ok === false) { setMsg({ ok: false, text: ERR[r.error ?? r.data.error] ?? r.error ?? r.data.error }); return; }
    setMsg({ ok: true, text: `✓ Saved: ${form.provider === 'gemini' ? 'Gemini' : 'Claude'} · ${form.model} · ${form.mode === 'testing' ? 'Testing' : 'Production'}. Every company uses it within a minute.` });
    load();
  }

  async function toggleCompany(c, on) {
    const home = c.isHome;
    const current = home ? homeFeatures : (c.features ?? {});
    const next = { ...current };
    if (on) delete next.ai; else next.ai = false;
    if (!await confirmDialog({ title: `${on ? 'Switch on' : 'Switch off'} AI for ${c.name}?`, message: on ? 'AI features come back for everyone in this company.' : 'Every AI feature is hidden / refused for everyone in this company.', confirmText: on ? 'Switch on' : 'Switch off' })) return;
    setBusy(c.name);
    let ok;
    if (home) ok = await saveHomeFeatures(next);
    else ok = !(await saveCompanySettings(owner, c.code, { features: next })).error;
    setBusy('');
    if (!ok) { setMsg({ ok: false, text: `Could not save AI for ${c.name}.` }); return; }
    ownerLog(owner, 'company_settings', codeOf(c), `AI ${on ? 'on' : 'off'}`, { ai: on });
    companyAudit(c.prefix ?? '', owner, 'owner_set_pages', {}, { ai: on });
    setMsg({ ok: true, text: `✓ AI ${on ? 'switched on' : 'switched off'} for ${c.name}.` });
    if (home) setHomeFeatures(next); else onChanged?.();
  }

  const nameOf = code => (code === '__home__' ? rows.find(r => r.isHome)?.name ?? 'Home' : rows.find(r => r.prefix === code)?.name ?? code);
  if (cfg === undefined) return <div className="loading-row"><div className="spinner" /> Loading AI settings…</div>;
  return (
    <div className="fg-page oai">
      {msg && <div className={msg.ok ? "oai-ok" : "ot-err"} role="status" style={{ marginBottom: 12 }}>{msg.text}</div>}
      {form && (
        <div className="card mb-16">
          <div className="card-header"><div className="card-title">AI provider</div></div>
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>
            Every AI feature goes through the <code>ai</code> server function. Keys are Supabase secrets (<code>GEMINI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>) —
            they never reach this page or the browser. Steps: docs/AI_SETUP.md.
          </p>
          <div className="oai-grid">
            <fieldset>
              <legend className="text-sm bold">Provider</legend>
              {[['gemini', 'Gemini (Google)', 'GEMINI_API_KEY'], ['claude', 'Claude (Anthropic)', 'ANTHROPIC_API_KEY']].map(([v, l, secret]) => (
                <label key={v} className="omp-check">
                  <input type="radio" name="oai-provider" checked={form.provider === v}
                    onChange={() => setForm(f => ({ ...f, provider: v, model: v === cfg.provider ? cfg.model : v === 'gemini' ? 'gemini-3.8-flash' : 'claude-opus-5-5', mode: v === 'gemini' ? 'testing' : f.mode }))} />
                  <span>{l} <span className="text-sm text-muted">— {secret}: {keyState(v)}</span></span>
                </label>
              ))}
            </fieldset>
            <label className="ocd-field">
              <span className="text-sm bold">Model</span>
              {list ? (
                <select value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}>
                  {!list.some(m => m.id === form.model) && <option value={form.model}>{form.model} (not in the provider’s list)</option>}
                  {list.map(m => <option key={m.id} value={m.id}>{m.id}{m.label && m.label !== m.id ? ` — ${m.label}` : ''}</option>)}
                </select>
              ) : (
                <input type="text" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value.trim() }))} aria-label="Model" />
              )}
              <span className="text-sm text-muted">{form.provider === 'gemini' ? 'Default: gemini-3.8-flash. If it is busy the function retries, then uses gemini-3.6-flash / gemini-3.5-flash-lite.' : 'e.g. claude-opus-5-5'}</span>
            </label>
            <fieldset>
              <legend className="text-sm bold">Mode</legend>
              <label className="omp-check">
                <input type="radio" name="oai-mode" checked={form.mode === 'testing'} onChange={() => setForm(f => ({ ...f, mode: 'testing' }))} />
                <span>Testing (no real data) <span className="text-sm text-muted">— yellow banner on every AI feature; MBI / SSN / phone / name + DOB blocked</span></span>
              </label>
              <label className="omp-check">
                <input type="radio" name="oai-mode" checked={form.mode === 'production'} disabled={form.provider !== 'claude'} onChange={() => setForm(f => ({ ...f, mode: 'production' }))} />
                <span>Production (BAA-covered){form.provider !== 'claude' && <span className="text-sm text-muted"> — Claude only: Gemini’s AI Studio key has no BAA</span>}</span>
              </label>
              {form.provider === 'claude' && form.mode === 'production' && (
                <label className="omp-check">
                  <input type="checkbox" checked={!!form.baa} onChange={e => setForm(f => ({ ...f, baa: e.target.checked }))} />
                  <span>BAA signed with Anthropic</span>
                </label>
              )}
            </fieldset>
          </div>
          <div className="si-actions">
            <span className="text-sm text-muted" style={{ marginRight: 'auto' }}>Now: {cfg.provider} · {cfg.model} · {cfg.mode}{cfg.updated_by ? ` — changed by ${cfg.updated_by} ${String(cfg.updated_at).slice(0, 10)}` : ''}</span>
            <button type="button" className="btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">AI per company</div></div>
        <table>
          <thead><tr><th>Company</th><th>AI</th><th /></tr></thead>
          <tbody>
            {rows.map(c => {
              const on = isFeatureOn(c.isHome ? homeFeatures : c.features, 'ai');
              return (
                <tr key={c.prefix || 'home'}>
                  <td>{c.name}{c.isHome ? ' (home)' : ''}</td>
                  <td>{c.isHome && homeFeatures === undefined ? '…' : on ? <span className="badge badge-green">On</span> : <span className="badge badge-gray">Off</span>}</td>
                  <td><button type="button" className="btn-sm" disabled={!!busy || (c.isHome && homeFeatures === undefined)} onClick={() => toggleCompany(c, !on)}>{on ? 'Switch off' : 'Switch on'}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">Usage — last 30 days</div></div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>Counts only — the text sent or received is never stored.</p>
        {!cfg?.usage?.length ? <p className="text-sm text-muted">No AI calls yet.</p> : (
          <div className="table-wrap">
            <table className="ocd-table">
              <thead><tr><th>Company</th><th>Feature</th><th>Provider</th><th>Calls</th><th>Answered</th><th>Tokens in / out</th></tr></thead>
              <tbody>
                {cfg.usage.map((u, i) => (
                  <tr key={i}><td>{nameOf(u.company)}</td><td>{FEATURE_LABEL[u.feature] ?? u.feature}</td><td>{u.provider}</td><td>{u.calls}</td><td>{u.ok}</td>
                    <td>{Number(u.input_tokens).toLocaleString()} / {Number(u.output_tokens).toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
