// Helix Hub — security stage 4 (2026-11-01): AI requests go through here so the company's Anthropic key never reaches
// the browser. The app POSTs a Messages API body with its session key (x-helix-session); this function checks the
// session and the company's AI switch (rcm.ai_key_for_session), adds the key, forwards the request to Anthropic and
// records who / when / model / token counts (rcm.ai_log_usage). It never stores or logs the request or the answer.
// Deploy: Supabase → Edge Functions → helix-ai, with "Verify JWT" off (the Helix session is checked below).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
const MAX_TOKENS = 16000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-helix-session',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  db: { schema: 'rcm' },
  auth: { persistSession: false },
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { code: 'METHOD' });

  const { data: who, error } = await db.rpc('ai_key_for_session', { p_token: req.headers.get('x-helix-session') });
  if (error) return reply(500, { code: 'SERVER', message: 'The AI service is not set up correctly.' });
  if (who?.error) return reply(403, { code: who.error });   // SESSION | AI_OFF | NO_KEY

  let body;
  try { body = await req.json(); } catch { return reply(400, { code: 'BAD_REQUEST', message: 'The AI request could not be read.' }); }
  if (!ALLOWED_MODELS.has(body?.model)) return reply(400, { code: 'MODEL', message: 'That AI model is not allowed.' });
  body.max_tokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS);
  delete body.stream;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': who.key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();

  let usage: { input_tokens?: number; output_tokens?: number } = {};
  try { usage = JSON.parse(text).usage ?? {}; } catch { /* not JSON — keep the status only */ }
  await db.rpc('ai_log_usage', {
    p_prefix: who.prefix, p_emp_id: who.emp_id, p_as_owner: who.as_owner, p_model: body.model,
    p_status: upstream.status, p_input: usage.input_tokens ?? null, p_output: usage.output_tokens ?? null,
  });

  return new Response(text, { status: upstream.status, headers: { ...CORS, 'content-type': 'application/json' } });
});
