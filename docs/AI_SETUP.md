# Helix Hub AI — setup (Edge Function `ai`)

Every AI feature in Helix Hub calls one Supabase Edge Function, **`ai`** (`supabase/functions/ai/index.ts`).
The API keys live **only** in Supabase secrets — never in the app, in code, in `.env` files or in chat.

| Secret name | Used for |
|---|---|
| `GEMINI_API_KEY` | Google Gemini — **Testing only** (no BAA) |
| `ANTHROPIC_API_KEY` | Claude — later, for Production with a signed BAA |

Provider, model and mode are chosen in **Owner Console → Platform → AI** (Stage 2). Until then the default is
**Gemini · `gemini-3.8-flash` · Testing** (migration 58).

> ⚠ **Testing mode = no real data.** The Gemini key from Google AI Studio is not covered by a HIPAA BAA, and on the
> free tier Google may use prompts to improve its products. Use made-up text only. Requests containing an MBI, an SSN,
> a phone number or a name + date of birth are blocked in the browser and again in the `ai` function.

---

## (a) Add the `GEMINI_API_KEY` secret

1. **Get a Gemini API key** (do this yourself — never paste it into chat):
   1. Open <https://aistudio.google.com> and sign in with the company Google account.
   2. Click **Get API key** (left menu) → **Create API key** → pick or create a Google Cloud project → **Create**.
   3. Click **Copy** next to the new key. Keep this browser tab open until step 2 is done.
   4. Recommended: in the same project turn on billing (paid tier) — Google does not use paid-tier prompts to improve
      its products. Testing still means no real data.
2. **Save it in Supabase:**
   1. Open <https://supabase.com/dashboard> → project **HelixHub** (`blgwwlzidffeuvtkjdwe`).
   2. Left menu → **Edge Functions** → **Secrets** (in the Edge Functions sub-menu; on some layouts:
      **Project Settings → Edge Functions → Secrets**).
   3. Click **Add new secret**.
   4. **Name:** `GEMINI_API_KEY` (exactly, capital letters). **Value:** paste the key from step 1.
   5. Click **Save**. The value is hidden afterwards; Supabase only shows a fingerprint.
3. Close the AI Studio tab. Don't save the key anywhere else.

To change the key later: AI Studio → create a new key → in Supabase **Secrets** edit `GEMINI_API_KEY` → paste → Save →
then delete the old key in AI Studio. No redeploy is needed — the function reads the secret on every request.

## (b) Deploy the `ai` function

1. In the repo, open `supabase/functions/ai/index.ts` and copy the **whole file** (Ctrl+A, Ctrl+C).
2. Supabase dashboard → project **HelixHub** → **Edge Functions** → **Deploy a new function** → **Via Editor**.
3. **Function name:** `ai` (lower case, exactly).
4. The editor opens with a sample `index.ts` — select all of it and paste the copied file instead.
5. Click **Deploy function** (bottom right). Wait for "Deployed".
6. Leave **Verify JWT** as it is (ON) — the app's public key passes it, and the function also checks the Helix session.
7. Tell Claude "Deployed" — the next step is a test with made-up text through every AI feature.

### Updating the function later
Edge Functions → **ai** → **Code** → paste the new file → **Deploy updates**.

### Checking it works
- Edge Functions → **ai** → **Logs**: each call shows one line with the status. The function never logs the text.
- Owner Console → Platform → AI (Stage 2): calls per feature and company for the last 30 days.

## Later: Claude for Production
1. Sign a BAA with Anthropic.
2. Supabase → Edge Functions → Secrets → **Add new secret**: `ANTHROPIC_API_KEY` = the Anthropic key.
3. Owner Console → Platform → AI → provider **Claude**, mode **Production**, tick **BAA signed** → Save.
