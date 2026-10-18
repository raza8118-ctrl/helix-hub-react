# Helix Hub – Rules for Claude Code

## What this project is
Helix Hub is 3Gen Consulting Services' internal platform for the RCM teams (AR, Auth, Billing/Posting, Coding, Credentialing).
It already has production & quality tracking. We are now adding productivity tools step by step.
The full plan is in `docs/HELIX_ROADMAP.md`. Always read it before starting work.

Stack: Vite + React 19 single-page app (no Next.js, no server code yet), Supabase (schema `rcm`, called from the browser; custom login via the `users` table, not Supabase Auth; storage), Vercel. Project map: `docs/PROJECT_MAP.md`.

## Golden rules (never break these)
1. **One step at a time.** Only build the single roadmap step I name. Do not start the next step on your own.
2. **Plan first.** Before writing code, show me: the files you will create, the files you will change, and any database changes. Wait for my "go".
3. **Do not break what works.** Do not rename, delete or rewrite existing pages, components, tables or APIs unless I explicitly ask. Add new code beside old code.
4. **Database changes are additive only.** New tables/columns go in a new Supabase migration file. Never drop or rename existing tables or columns. Never delete data.
5. **No secrets in code.** Keys go in `.env.local` only. Never print, change or commit `.env*` files.
6. **HIPAA / PHI:**
   - Never send patient data (name, DOB, MBI/member ID, MRN, address, claim notes with PHI) to any AI API.
   - AI-generated letters use placeholders like `[PATIENT_NAME]`, `[MEMBER_ID]`; the app fills real values locally.
   - Never log PHI to the console or to analytics.
   - File merge/convert of patient files runs in the browser or on our own server, never a third-party converter site/API.
   - Every new module uses role-based access and writes to the audit log.
7. **Check before finishing.** Run `npm run lint` and `npm run build`. Fix any errors you caused. Tell me how to test the feature in the browser.
8. **Finish cleanly.** At the end: tick the step's checkbox in `docs/HELIX_ROADMAP.md`, give me a short summary of what changed, and suggest a git commit message. Do not commit or push unless I ask.
9. **If unsure, ask.** If something in the existing code is unclear or a step would require changing working features, stop and ask me.

## Style
- Keep the existing look (layout, colors, components). New modules appear in the existing sidebar/navigation.
- Plain-English labels for RCM users. Copy buttons on any value users paste elsewhere (phone, fax, address, payer ID).
- Mobile-friendly layouts.
