// AI requests (PO 2026-11-12): every AI feature goes through the Supabase Edge Function "ai", which checks the sign-in
// and the company's AI switch, uses the provider / model / mode set in Owner Console → Platform → AI, and adds the key
// from a Supabase secret on the server. The browser never sees a key. Send only placeholders / de-identified text.
// Until "ai" is deployed, requests fall back to the older "helix-ai" function (company Anthropic key).
import { supabase, getSessionToken, SUPABASE_URL, SUPABASE_PUBLIC_KEY } from './supabase';
import { AI_OFF_MESSAGE } from './companyFeatures';
import { testingAiBlock } from './phiCheck';

export const AI_MODEL = 'claude-opus-5-5';

// Provider / model / mode (no secrets), cached for a minute — drives the Testing banner and the browser-side block
let cfg = null;
let cfgAt = 0;
export async function aiConfig() {
  if (cfg && Date.now() - cfgAt < 60000) return cfg;
  const { data, error } = await supabase.rpc('ai_config_public');
  cfg = error || !data ? { provider: 'claude', model: AI_MODEL, mode: 'production', legacy: true } : data;
  cfgAt = Date.now();
  return cfg;
}

/** The text the user typed in this request (not the system prompt, tool results or attached files). */
function typedText(body) {
  return (body?.messages ?? []).filter(m => m.role === 'user')
    .flatMap(m => (typeof m.content === 'string' ? [m.content] : (m.content ?? []).filter(b => b?.type === 'text').map(b => b.text ?? '')))
    .join('\n');
}

const post = (fn, body) => fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_PUBLIC_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
    'content-type': 'application/json',
    'x-helix-session': getSessionToken() ?? '',
  },
  body: JSON.stringify(body),
});

/**
 * POSTs a Messages-style body and returns the Response (Anthropic answer shape, whatever the provider), so each caller
 * keeps its own error wording (401 = key rejected, 429 = busy). feature = which page is asking (usage counts per feature).
 * Throws Error('NO_KEY') when no key is set, or a plain-English Error when the sign-in has ended, AI is off for the
 * company, or (Testing mode) the text looks like it holds patient details.
 */
export async function aiFetch(body, { feature = 'unknown' } = {}) {
  const c = await aiConfig();
  if (c.mode === 'testing') {
    const found = testingAiBlock(typedText(body));
    if (found) throw new Error(`Testing AI: the text looks like it contains ${found}. Remove patient details and try again.`);
  }
  let res = await post('ai', { ...body, feature });
  if (res.status === 404) res = await post('helix-ai', body);   // "ai" not deployed yet
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    if (err.code === 'NO_KEY') throw new Error('NO_KEY');
    if (err.code === 'AI_OFF') throw new Error(AI_OFF_MESSAGE);
    throw new Error('Your sign-in has ended — please sign in again to use AI.');
  }
  if (res.status === 422) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? 'Testing AI: remove patient details and try again.');
  }
  return res;
}

/** Settings / pages: { saved, ending } for the signed-in company — never the key itself. (Old key, removed in Stage 3.) */
export async function aiKeyStatus() {
  const { data, error } = await supabase.rpc('ai_key_status');
  return error || !data ? { saved: false } : data;
}

export async function saveAiKey(key) {
  const { error } = await supabase.rpc('set_ai_key', { p_key: key });
  return error ? error.message.replace(/^.*?: /, '') : null;
}

export async function clearAiKey() {
  const { error } = await supabase.rpc('clear_ai_key');
  return error ? error.message.replace(/^.*?: /, '') : null;
}
