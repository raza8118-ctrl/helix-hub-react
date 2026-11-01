// Security stage 4 (2026-11-01): every AI request goes through the Supabase Edge Function "helix-ai", which checks the
// sign-in and the company's AI switch, adds the company's Anthropic key on the server and forwards the request.
// The browser never sees the key. As before, send only placeholders / de-identified text — never patient data.
import { supabase, getSessionToken, SUPABASE_URL, SUPABASE_PUBLIC_KEY } from './supabase';
import { AI_OFF_MESSAGE } from './companyFeatures';

export const AI_MODEL = 'claude-opus-5-5';

/**
 * POSTs a Messages API body and returns the Response, so each caller keeps its own error wording (401 = key
 * rejected, 429 = busy). Throws Error('NO_KEY') when no key is saved, or a plain-English Error when the sign-in
 * has ended or AI is switched off for the company.
 */
export async function aiFetch(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/helix-ai`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLIC_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
      'content-type': 'application/json',
      'x-helix-session': getSessionToken() ?? '',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    if (err.code === 'NO_KEY') throw new Error('NO_KEY');
    if (err.code === 'AI_OFF') throw new Error(AI_OFF_MESSAGE);
    throw new Error('Your sign-in has ended — please sign in again to use AI.');
  }
  return res;
}

/** Settings / pages: { saved, ending } for the signed-in company — never the key itself. */
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
