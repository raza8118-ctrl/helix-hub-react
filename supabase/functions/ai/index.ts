// Helix Hub — the "ai" Edge Function (PO 2026-11-12). Every AI feature calls this. It:
//   1. checks the Helix session (x-helix-session) and the company's AI switch (rcm.ai_session_check),
//   2. reads the provider / model / mode chosen in Owner Console → Platform → AI (rcm.helix_ai_config),
//   3. in TESTING mode blocks requests whose typed text holds an MBI, a name + DOB, a phone number or an SSN,
//   4. sends the request to Gemini (translated from the app's Anthropic-style body) or to Claude (passed through),
//      with the key from a Supabase secret — GEMINI_API_KEY or ANTHROPIC_API_KEY — which never leaves the server,
//   5. answers in the Anthropic shape the app already reads, and logs who / when / feature / provider / model / tokens
//      (rcm.ai_log_usage_v2). It never stores or logs the request or the answer.
// Deploy: Supabase → Edge Functions → Deploy a new function → name "ai" → paste this file. Secrets: Edge Functions → Secrets.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_TOKENS = 16000;
const CLAUDE_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-helix-session',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const apiError = (status: number, type: string, message: string) => reply(status, { type: 'error', error: { type, message } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  db: { schema: 'rcm' },
  auth: { persistSession: false },
});

// ── Testing mode: identifiers that must never reach a non-BAA provider (same rules as src/lib/phiCheck.js) ─────
const MBI_CH = '[AC-HJKMNP-RT-Y]';
const MBI = new RegExp(`\\b[1-9]${MBI_CH}[AC-HJKMNP-RT-Y0-9]\\d-?${MBI_CH}[AC-HJKMNP-RT-Y0-9]\\d-?${MBI_CH}{2}\\d{2}\\b`, 'i');
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const PHONE = /(?:\(\d{3}\)\s*|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/;
const DOB_WORD = /\b(?:dob|d\.o\.b\.?|date\s+of\s+birth|birth\s*date|born(?:\s+on)?)\b/i;
const NAME = /\b(?:patient(?:'s)?\s+name|pt\.?\s+name|name|patient|pt)\s*[:#]|\b(?:Mr|Mrs|Ms|Mx|MR|MRS)\.\s*[A-Z][A-Za-z'-]+|\b(?:Mrs|Miss|MRS|MISS)\s+[A-Z][A-Za-z'-]+/;
const FULL_DATE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i;

/** What the user typed (not system prompts, tool results or attached PDFs). */
function typedText(body: any): string {
  const out: string[] = [];
  for (const m of body?.messages ?? []) {
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') out.push(m.content);
    else for (const b of m.content ?? []) if (b?.type === 'text') out.push(String(b.text ?? ''));
  }
  return out.join('\n');
}
function testingBlock(text: string): string | null {
  if (MBI.test(text)) return 'a Medicare number (MBI)';
  if (SSN.test(text)) return 'a Social Security number';
  if (PHONE.test(text)) return 'a phone number';
  if (DOB_WORD.test(text) || (NAME.test(text) && FULL_DATE.test(text))) return 'a name and date of birth';
  return null;
}

// ── Gemini: Anthropic-style request → generateContent, and the answer back ─────────────────────────
const SKIP_SIGNATURE = 'skip_thought_signature_validator';   // for tool calls Gemini didn't make (none in practice)

function toGemini(body: any) {
  const system = typeof body.system === 'string' ? body.system : (body.system ?? []).map((b: any) => b?.text ?? '').join('\n');
  const toolName = new Map<string, string>();
  for (const m of body.messages ?? []) if (m.role === 'assistant' && Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'tool_use') toolName.set(b.id, b.name);
  const parts = (content: any, role: string) => {
    if (typeof content === 'string') return content ? [{ text: content }] : [];
    const out: any[] = [];
    for (const b of content ?? []) {
      if (b?.type === 'text' && b.text) out.push(role === 'model' && b.signature ? { text: b.text, thoughtSignature: b.signature } : { text: b.text });
      else if ((b?.type === 'document' || b?.type === 'image') && b.source?.type === 'base64') out.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
      else if (b?.type === 'tool_use') out.push({ functionCall: { name: b.name, args: b.input ?? {} }, thoughtSignature: b.signature || SKIP_SIGNATURE });
      else if (b?.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c: any) => c?.text ?? '').join('\n');
        out.push({ functionResponse: { name: toolName.get(b.tool_use_id) ?? 'tool', response: b.is_error ? { error: text } : { result: text } } });
      }
    }
    return out;
  };
  const contents = (body.messages ?? []).map((m: any) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    return { role, parts: parts(m.content, role) };
  }).filter((c: any) => c.parts.length);
  const generationConfig: any = { maxOutputTokens: Math.max(8192, Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS) * 2) };   // thinking counts too
  const fmt = body.output_config?.format;
  if (fmt?.type === 'json_schema') { generationConfig.responseMimeType = 'application/json'; generationConfig.responseJsonSchema = fmt.schema; }
  const out: any = { contents, generationConfig };
  if (system) out.systemInstruction = { parts: [{ text: system }] };
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = [{ functionDeclarations: body.tools.map((t: any) => ({ name: t.name, description: t.description ?? '', parametersJsonSchema: t.input_schema ?? { type: 'object', properties: {} } })) }];
    const tc = body.tool_choice?.type;
    out.toolConfig = { functionCallingConfig: tc === 'none' ? { mode: 'NONE' } : tc === 'any' ? { mode: 'ANY' }
      : tc === 'tool' ? { mode: 'ANY', allowedFunctionNames: [body.tool_choice.name] } : { mode: 'AUTO' } };
  }
  return out;
}

function fromGemini(json: any, model: string) {
  const cand = json?.candidates?.[0];
  const content: any[] = [];
  let n = 0;
  for (const p of cand?.content?.parts ?? []) {
    if (p.thought) continue;   // thinking summaries are not part of the answer
    if (p.functionCall) content.push({ type: 'tool_use', id: `toolu_g${Date.now().toString(36)}_${n++}`, name: p.functionCall.name, input: p.functionCall.args ?? {}, ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}) });
    else if (typeof p.text === 'string' && p.text) content.push({ type: 'text', text: p.text, ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}) });
  }
  const fr = cand?.finishReason;
  const stop_reason = json?.promptFeedback?.blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII'].includes(fr) ? 'refusal'
    : content.some(c => c.type === 'tool_use') ? 'tool_use' : fr === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
  const u = json?.usageMetadata ?? {};
  return {
    id: `msg_g${Date.now().toString(36)}`, type: 'message', role: 'assistant', model, content, stop_reason,
    usage: { input_tokens: u.promptTokenCount ?? 0, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) },
  };
}

/** Claude doesn't know the Gemini extras the app may send back (signature on tool_use / text). */
function forClaude(body: any) {
  const messages = (body.messages ?? []).map((m: any) => (Array.isArray(m.content)
    ? { ...m, content: m.content.map((b: any) => (b?.type === 'tool_use' || b?.type === 'text') && 'signature' in b && b.type !== 'thinking' ? (({ signature, ...rest }) => rest)(b) : b) }
    : m));
  const { feature, ...rest } = body;
  return { ...rest, messages };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { code: 'METHOD' });

  const { data: who, error } = await db.rpc('ai_session_check', { p_token: req.headers.get('x-helix-session') });
  if (error) return reply(500, { code: 'SERVER', message: 'The AI service is not set up correctly (run migration 58).' });
  if (who?.error) return reply(403, { code: who.error });   // SESSION | AI_OFF

  let body: any;
  try { body = await req.json(); } catch { return reply(400, { code: 'BAD_REQUEST', message: 'The AI request could not be read.' }); }
  const feature = String(body?.feature ?? 'unknown').slice(0, 40);
  if (!Array.isArray(body?.messages) || !body.messages.length) return reply(400, { code: 'BAD_REQUEST', message: 'The AI request has no messages.' });

  if (who.mode === 'testing') {
    const found = testingBlock(typedText(body));
    if (found) {
      await db.rpc('ai_log_usage_v2', { p_prefix: who.prefix, p_emp_id: who.emp_id, p_as_owner: who.as_owner, p_feature: feature,
        p_provider: who.provider, p_model: who.model, p_status: 422, p_input: null, p_output: null });
      return reply(422, { code: 'TEST_BLOCKED', message: `Testing AI: the text looks like it contains ${found}. Remove patient details and try again.` });
    }
  }

  let upstreamStatus = 0;
  let answer: any;
  let model = who.model;
  if (who.provider === 'gemini') {
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return reply(403, { code: 'NO_KEY', message: 'The Gemini key (secret GEMINI_API_KEY) is not set on the server.' });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(toGemini(body)),
    });
    upstreamStatus = res.status;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(json?.error?.message ?? `Gemini error ${res.status}`);
      const keyBad = /api key/i.test(msg) && res.status === 400;
      await db.rpc('ai_log_usage_v2', { p_prefix: who.prefix, p_emp_id: who.emp_id, p_as_owner: who.as_owner, p_feature: feature,
        p_provider: 'gemini', p_model: model, p_status: res.status, p_input: null, p_output: null });
      return apiError(keyBad ? 401 : res.status, keyBad ? 'authentication_error' : 'api_error', msg);
    }
    answer = fromGemini(json, model);
  } else {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return reply(403, { code: 'NO_KEY', message: 'The Claude key (secret ANTHROPIC_API_KEY) is not set on the server.' });
    model = CLAUDE_MODELS.has(who.model) ? who.model : (CLAUDE_MODELS.has(body.model) ? body.model : 'claude-opus-5-5');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'content-type': 'application/json' },
      body: JSON.stringify({ ...forClaude(body), model, max_tokens: Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS), stream: undefined }),
    });
    upstreamStatus = res.status;
    answer = await res.json().catch(() => ({ type: 'error', error: { type: 'api_error', message: `Claude error ${res.status}` } }));
    if (!res.ok) {
      await db.rpc('ai_log_usage_v2', { p_prefix: who.prefix, p_emp_id: who.emp_id, p_as_owner: who.as_owner, p_feature: feature,
        p_provider: 'claude', p_model: model, p_status: res.status, p_input: null, p_output: null });
      return reply(res.status, answer);
    }
  }

  await db.rpc('ai_log_usage_v2', { p_prefix: who.prefix, p_emp_id: who.emp_id, p_as_owner: who.as_owner, p_feature: feature,
    p_provider: who.provider, p_model: model, p_status: upstreamStatus, p_input: answer?.usage?.input_tokens ?? null, p_output: answer?.usage?.output_tokens ?? null });
  return reply(200, answer);
});
