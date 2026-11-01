# Helix Hub – Module Review

Review done 2026-10-30 at commit `e2dbeb1`. **No code was changed.**

## How this was tested

- Ran the app locally (`npm run dev`) against the live Supabase project, inside the **Test Co** company (`co_testco__*` tables), so no real team saw test data.
- Signed in as the Helix Hub owner → **Open** Test Co as admin. Employee pages were tested with Owner Console → Manage → Users → **🔑 Sign in as** the Test employee (1010).
- For each module: opened the page, added a record, saved, **reloaded the browser**, and checked the record was still there.
- Also ran `npm run lint` (**36 errors, 21 warnings**) and `npm run build` (passes, with one 1 MB main chunk).
- Dark theme checked on every page with a contrast scan plus screenshots. Phone width (375 px) checked on every Workbench and employee page for sideways scrolling.
- Not tested live: the **supervisor** view (Test Co has no supervisor user), **creating a user** (needs a password to be typed), and every **AI feature** (Test Co has no AI key). These are marked below.

Effort guide: **small** = under 1 day · **medium** = 1–3 days · **large** = more than 3 days or an architecture change.

### Test data left in Test Co

You can delete it or keep it: client *REVIEW Client*, payer *REVIEW Payer* (+ one Appeals contact), SOP category/software/task/SOP *REVIEW …* (v1 published), learning path *REVIEW Path* (assigned to Test), denial code *RV99* with 2 common steps, 8 starter appeal templates, 8 starter note formats, portal link *REVIEW Portal*, worklist *REVIEW Worklist* (2 claims), 14 starter QA scorecards + 1 draft audit, a handover draft, escalation E-0001, ADR-0001, provider *REVIEW Provider Agency* + 1 enrollment, notice *REVIEW notice*, payer bulletin *REVIEW bulletin*, announcement + feed post *"REVIEW … please ignore"*, Test's daily report for 30 Oct, allocation #1 (2 dummy rows), client query Q-0001, Test's team set to AR. The DST setting was changed and then put back.

---

## 1. Module status

### Workbench

| Module | Status | What is missing or broken | Effort |
|---|---|---|---|
| Payer Directory | Working | Payer, contact and reload all fine. Email and link fields accept anything (saved `x` as an email). "Verified by HELIX_OWNER" shows an ID, not a name. Forms upload not tested. | small |
| File Tools | Working | Merge PDFs tested up to the Download button. Split / Images / Excel→PDF / PDF→Excel / Appeal Packet open but were not each exercised. PDF→Excel server methods B–D need a server that doesn't exist yet (see `docs/PDF_EXTRACTION_SERVER.md`). | small (server: large) |
| SOP Library | Working | Category → software → task → SOP → edit content → publish v1 all persist. Small issues: "+ Software/+ Task/+ SOP" inside a row doesn't preselect that row (you pick it again). "1 tasks" / "1 SOPs" grammar. The login-link field isn't validated (it saved `https://REVIEW Software`). | small |
| Training | Working | Path, items and assignment all persist. Possible bug: on the path's start day (Fri 30 Oct) Team progress shows **Day 2 / 2** instead of 1 / 2. | small |
| Denial Navigator | Working | Code and common steps persist. The step layer is labelled **"Common 3Gen steps"** even inside Test Co (hard-coded company name). The Manage-steps table row only opens when you click the bold code (it's a `<td>`, not a button). | small |
| Appeal Builder | Working | Templates persist. The appeal form itself is never saved (by design, for PHI), so a reload or tab change loses a half-written letter; consider warning before leaving. AI panel not tested (no key). | small |
| AR Tools | Working | Note formats and portal links persist; calculators and code lookup load. Starter formats are named **"3Gen standard – …"** in every company. | small |
| Smart Worklist | **Partial → fixed 2026-10-31** (hidden until PO tests) | *Fixed after this review: (1) CSV files are now read as plain text, so dates save exactly as in the file (tested on Chicago time with `2026-08-01`, `08/15/2026` and an .xlsx date) and claim # keep leading zeros. (2) **Correction:** auto-mapping was never broken — the review's test script read the first dropdown option instead of the selected one; all columns map automatically. (3) Migration 35 adds a nightly Supabase job that wipes claim # / DOS 90 days after upload (PO to run it). Assign, status, follow-up and ✓ Done tested and working.* Originally: Upload, priority and reload work, but: **(1) dates are saved one day early** in US time zones (file `2026-08-01` → saved `2026-07-31`; `worklist.js:76` uses `cellDates: true` and then converts with local time), which shifts every deadline. `denials.js:158` uses the same pattern. (2) Column auto-mapping didn't recognise obvious headers ("Claim Number", "Payer", "Balance"), so all 10 columns had to be picked by hand. (3) The "wiped after 90 days" promise only runs when someone opens Smart Worklist (`SmartWorklist.jsx:41`); nothing runs on a schedule. Assign / work / follow-ups not tested. | medium |
| QA Audits | Working | Starter scorecards and a draft audit persist. Sampling, send-to-agent and dispute not tested. | small |
| Client Queries | **Broken → fixed 2026-10-30** | *Fixed after this review by deleting the stray lines; retested: query Q-0001 saves, survives a reload and shows on Aging.* Originally: the page crashed on open: *"This page ran into a problem – queries is not defined"*. `QueryAging.jsx` lines 1–4 are a stray copy of a `useMemo` block sitting above the imports, so the module throws as soon as it loads. Has been broken since commit `06b8177` (21 Oct). The data side still works (the weekly client report reads queries). | small |
| Handover & Escalations | Working | Handover draft and escalation E-0001 persist. Team inbox not tested (needs a second user on a team). | small |
| Medicare Trackers | Working | ADR saved with the correct due date (+45 days) and persisted. In dark mode the Overview tile numbers are **black on a dark background** (unreadable). RTP / suspense upload not tested. | small |
| Payer Updates | Working | "Add rows by hand" path saves and persists; the no-AI-key message is clear. AI extraction not tested. In the list, the category badge and text run together ("OtherREVIEW change"). | small |
| Ask Helix | Working (not verified) | The page loads and answers *"No AI key is saved in Settings"* correctly. Real answers and the Auth checklist were **not verified** (no key in Test Co). | small |
| Credentialing | Working | Provider and enrollment persist; validation works ("Please fill in: Payer"). Licenses and the AI checklist not tested. | small |
| Reports | Working | Weekly client report picks up live data (showed ADR-0001). Denial trends empty (no denial dates mapped). AI summary not tested. | small |
| Notice Board | Working | Notice posts and persists. "posted by HELIX_OWNER" shows an ID instead of a name. | small |

`WorkbenchPlaceholder.jsx` is no longer used: all 17 Workbench tabs route to real pages. There are **no placeholder modules left**.

### Admin, supervisor, employee and owner pages

| Module | Status | What is missing or broken | Effort |
|---|---|---|---|
| Login | Partial | Works. "Forgot password" is a dead end ("contact your administrator") because nothing creates a reset request. Still seeds `ADMIN / Admin@123` on an empty database. On narrow windows the left panel's feature text overlaps ("Role-aware dashboards…"). | medium |
| Team Dashboard | Working | Loads with live data. Several tile labels are cut off ("Reports miss…", "Break over li…", "Planned / C…", "Click for da…"). | small |
| Attendance (Keka) | Partial | Uses placeholder rules: late login after **09:15** and a 30-minute break limit (`constants.js:53-54`), which don't fit an evening US shift. With **no Keka import** it shows "Attendance 100% present today", which is misleading. Import not tested (needs a Keka file). | medium |
| Today | Working | Loads. Mark Holiday and AI Email not tested. AI Email uses the older model (`helpers.js:389`, `claude-opus-4-5`). | small |
| Prod Monitor | Working | Shows Test's saved report. Edit counts / bypass not tested. | small |
| Quality | Working | Loads the multi-day grid. | small |
| Hourly | Working | Loads US-shift slots. | small |
| Weekly / Monthly | Working | Loads charts and totals (picked up Test's 3 calls). | small |
| Team | Working | Editing a user (team → AR) persists. **The Edit User form shows the user's current password in a plain-text field.** Add User not tested (needs a password). | small |
| Work Alloc | Working | Upload → preview → allocate works. It still stores **every column of the file, including Patient Name**, in `rcm_store` (`alloc_<id>`); see the security section. | medium |
| Alloc Monitor | Working | Loads. | small |
| Announcements (post + employee view) | Working | Post to one employee → employee sees it → acknowledges → persists. | small |
| Team Feed / Feed Monitor | Working | Post persists and shows in Feed Monitor. Hide/Delete aren't written to the audit log. | small |
| Settings | Working | DST change saved and reloaded (then put back). The AI key box says "Saved securely", but any signed-in user can read the key (see security). | small |
| Clients & Payers | Working | Add client and payer persist. | small |
| Audit Log | Working | Shows entries with filters and CSV export. | small |
| Changelog | Working (owner only) | Still reachable only from the Owner Console (PROJECT_MAP 6.5). | small |
| Supervisor – My Team | Not tested live | No supervisor user in Test Co. By code it shares admin pages; reset approvals have nothing to approve (see Login). | small |
| Daily Report (employee) | **Partial → fixed 2026-10-31** | *Fixed after this review: (1) in an added company, "ALL" users now get that company's own processes (Test → TEST 01 with Denial / AR); 3Gen unchanged. (2) Found while testing: for custom processes the saved counts didn't show after a reload (the report loaded before the task list), and a re-save would have overwritten them with zeros — the report now waits for the task list. Tested: enter → save → reload → edit → re-save; Prod Monitor shows TEST 01, 45 / 50, 90%.* Originally: Save and reload work, and the 24-hour edit lock shows. **Bug for added companies:** a user whose process is "ALL" gets the 3Gen process **MCO** with an empty task table (`ProdReport.jsx:70` falls back to `'MCO'`), so they can't enter any task counts. Test Co's own tasks (Denial, AR under TEST 01) never show. | small |
| My Reports / Progress | Working | Show the saved report and calls. | small |
| My Allocation | Working | Loads (was empty before the allocation test). | small |
| Owner Console | Working | Overview, Companies, Manage → Users, Sign in as and Open all work. Add / rename / delete company and broadcasts not tested (would affect real data). | small |

### Code health (lint)

`npm run lint` reports 36 errors. Most are React "setState in effect" and unused variables, which don't break anything today. The ones that matter:

- `QueryAging.jsx` – the crash above.
- `Summary.jsx:79`, `MyReports.jsx:20`, `Progress.jsx:23`, `MyAllocation.jsx:66`, `ProdReport.jsx:178` – "Cannot access variable before it is declared". These work now only because of the order effects run in, so they're fragile.
- `AppealSidePanel.jsx:36`, `DenialLayers.jsx:57` – "This value cannot be modified" (a prop or state is mutated).

---

## 2. UI problems

**Layouts that break / odd spacing**
1. **Modals are clipped and their backdrop is confined** (Clients & Payers, Credentialing enrollment, others using the shared Modal): the modal's title row sits under the top bar, and the dark backdrop only covers the page card instead of the whole screen. The confirm dialog (`Dialog.jsx`) is fine, so the two components behave differently.
2. **File save options** (Appeal Builder → Build the PDF, File Tools): radio buttons sit in the middle of the card with their labels pushed to the far right.
3. Checkbox labels wrap into narrow columns: "Fax / cover / sheet", "Cover / letter", "Show / inactive" (Credentialing), "Show / empty" (Appeal facts summary).
4. Daily Report header: "Export CSV" and "Save Report" wrap onto two lines at 1366 px.
5. Team Dashboard tile labels truncated (see table).
6. Payer Updates list: category badge and text have no gap ("OtherREVIEW change").
7. Login left panel: feature text overlaps at ~800 px wide.

**Inconsistent behaviour and styles**
8. Some saves ask "Are you sure?" (Clients & Payers, Settings, Team, starter templates) and others save at once (Training path, QA starter scorecards, escalations, notices). Pick one rule.
9. Records show `HELIX_OWNER` / emp IDs instead of names in several places ("Verified by", "posted by", Medicare owner).
10. Company-specific wording is hard-coded for 3Gen in shared modules: "Common 3Gen steps", "3Gen standard – …" note formats, and the Daily Report's MCO fallback.
11. Grammar: "1 tasks", "1 SOPs", "1 codes".

**Buttons that do nothing / dead ends**
12. Client Queries page crashes, so none of its buttons can be reached.
13. Login → "Forgot password" leads nowhere; reset requests are never created.
14. AI buttons (AI Email, AI Summary, Extract with AI, Ask Helix, Write summary, Auth/Enrollment checklists) all fail without a key. They do say so clearly, but they stay clickable. Consider hiding or greying them when no key is saved.

**Dark / light theme**
15. **Medicare Trackers → Overview:** tile numbers are black (`rgb(0,0,0)`) on the dark card (contrast 1.2 : 1), so they can't be read.
16. **Appeal Builder letter:** placeholders like `[CLIENT_NAME]` are near-white text on pale-yellow highlight in dark mode, so they can't be read.
17. The starfield background shows through translucent cards in dark mode and makes some tables busy. Not broken, but heavy.
18. Everything else passed the dark-mode contrast scan. Flags on Team Dashboard, Weekly and Daily Report were gradient text that is readable.

**Mobile (375 px)**
19. No page scrolls sideways; tables scroll inside their cards. Good.
20. The owner banner plus the "You haven't submitted your daily report" banner take about a quarter of the phone screen on every page. Consider making them collapsible.
21. Denial Navigator's collapsed "Deadline helper" row wraps awkwardly.

**Console noise**
22. Every page load logs several `406` errors. `kv.get` (`supabase.js:118`) uses `.single()`, which returns 406 when a key doesn't exist yet. Harmless, but it hides real errors. `.maybeSingle()` would silence it.

---

## 3. Security gaps still open from PROJECT_MAP sections 5 and 6

The **live checks** below were run from the Test Co employee session (Test, 1010) in the browser console using the app's own Supabase client. Only counts were printed, never values.

| # | Gap (PROJECT_MAP ref) | Status | Evidence |
|---|---|---|---|
| A | **Plain-text passwords, login checked in the browser** (5, 6.12) | **Partly fixed – stage 1** | `Login.jsx:176` compares `u.password !== password` in the browser. Live: the Test Co employee could read **22 of 22 password rows in the 3Gen home company's `users` table**, and 2 of 2 in Test Co. Stage 1: passwords stored scrambled (bcrypt) and checked in the database (`rcm.user_login`); the browser no longer receives them. Stage 2 (2026-10-31): scrambled passwords moved to a locked table the anon key can't read; sign-in gives a 12-hour session key; 5 wrong tries lock an ID for 15 minutes. Still open until stage 3: other tables readable / writable with the anon key. |
| B | **No row-level security; anon key can read/write any table** (5, 6.12) | **Fixed – stage 3 (2026-10-31), on for 3Gen and Test Co** — every table now needs a session for that company or the owner key; users can't promote themselves; audit log add-only. Per-table rules inside a company: phase 1 done (stage 6 — logs, setup, libraries, settings store; on for Test Co); phase 2 (workflow tables, Team Feed) open. | Live: the same employee session could **write** to `users` (no-op update accepted). Company separation is app-only: an added company's user can read the home company's tables. `helix_owners` is the only table tested that was blocked (`42501`). |
| C | **AI key readable by any signed-in user** (6.11) | **Fixed – stage 4 (2026-11-01)** — the key lives in locked `helix_ai_keys`; AI calls go through the `helix-ai` Edge Function, which checks the session and adds the key on the server. | Live: the Test Co employee could read the **3Gen home company's** `anthropic_key` row in `rcm_store`. The key is used straight from the browser (`anthropic-dangerous-direct-browser-access`). The Settings text "Saved securely" is not accurate. |
| D | **AI model hard-coded** (6.11) | **Mostly fixed – stage 4** — one shared `AI_MODEL` in `lib/ai.js` (helpers / reports use it; the old `claude-opus-4-5` is gone); the server allows only listed models. Three modules still keep their own `MODEL` constant (same value). | Now hard-coded in 6 places with two different models: `helpers.js:389` (`claude-opus-4-5`, used by AI Email/Summary) and `claude-opus-5-5` in `appealAI.js`, `assistant.js`, `payerSuggestions.js`, `payerUpdates.js`, `reports.js`. |
| E | **Work Allocation stores full worklists (PHI) in `rcm_store`** (6.13) | **Fixed – stage 1** | Live: allocating a 4-column dummy file saved all 4 columns, **including "Patient Name"**, to `rcm_store` key `alloc_1` (`WorkAllocation.jsx:229`). Readable by anyone with the anon key (see B). Smart Worklist already drops patient columns; Work Allocation doesn't. Stage 1: patient columns are dropped before saving (same rule as Smart Worklist), and migration 36 strips them from lists already saved. |
| F | **Default admin seeding `ADMIN / Admin@123`** (5) | **Fixed – stage 1** | `Login.jsx:66-68`, unchanged. Removed in stage 1. |
| G | **Password reset flow incomplete** (6.3) | **Partly fixed – stage 1** | Nothing creates `reset_requests`. When one is approved, the temporary password is written in plain text to both `users.password` and `reset_requests.temp_password` (`TeamMgmt.jsx:356-357`, `SupervisorTeam.jsx:33`). Stage 1: the temporary password is shown once and no longer saved; old saved ones are blanked by migration 36. Still open: nothing creates reset requests. |
| H | **Giphy API key hard-coded** (6.14) | **Open – low** | `constants.js:97`. |
| I | **`feed-media` bucket is public** (6.15) | **Fixed – stage 5 (2026-11-01)** — all four buckets private with company rules (session for that company or owner key); feed photos shown through 1-hour signed links. | Still public. The newer buckets (payer forms, SOP media, bulletins) are private, but their own migration comments note they're still readable by anyone with the anon key until Supabase Auth exists. |
| J | **Supervisor permissions all default ON** (5) | **Open – low** | `helpers.js:188-191` (`resetPassword`, `bypassDeadline`, `editCounts` … all `true`). |
| K | **`call_logs` orphaned** (6.2) | Open – housekeeping | `EmpDetail.jsx:275` still deletes from it; nothing writes it. |
| L | **No baseline schema for the core tables** (6.7) | Open – housekeeping | 34 migrations add new tables, but `users`, `daily_logs`, `hourly_logs`, etc. still have no create script in the repo. |
| M | **Keka placeholder rules** (6.4) | Open | See the Attendance row above. |
| — | Audit log has no viewer (6.1) | **Fixed** | Audit Log page. Sign-ins, user create/edit, settings, allocations and announcements are now logged. Feed Hide/Delete still aren't. |
| — | No clients/payers master (6.6) | **Fixed** | Clients & Payers page + migration `20261018c`. |
| — | `VITE_ANTHROPIC_KEY` sent to Anthropic (6.10) | **Fixed** | `callAI` only uses the Settings key now. |

### New security findings (not in PROJECT_MAP)

1. **Edit User shows the current password in clear text.** The Team → Edit form pre-fills `users.password` into a `type="text"` field, so any admin or manager sees every password. *(high)* *(fixed in security stage 1, 2026-10-31 — active once migration 36 is run)*
2. **The owner master password is kept in plain text in `sessionStorage` (`hh_owner.password`)** and sent with every owner RPC (`owner.js:9`). Any script injected into the page could take over every company. *(high)* *(fixed in security stage 1, 2026-10-31 — active once migration 36 is run)*
3. **The 90-day PHI wipe isn't scheduled.** *(Smart Worklist: fixed 2026-10-31 by migration 35, once run. The other modules below are still open.)* Claim numbers and dates of service in Smart Worklist (and the 90-day clears in Client Queries, Escalations, Handover, Medicare and QA) only run when someone opens that page in a browser. Nothing runs on a schedule. *(medium)*
4. **Owner "Sign in as" needs no reason**: the reason field is optional. It is logged, which is good. *(low)*

**Bottom line:** gaps A, B and C (plain-text passwords, no row-level security, readable AI key) are the same root problem: the browser holds a key that can read and write everything, in **every** company. Together with E, they should be fixed (Supabase Auth + RLS, or a small server layer) before more client data, and especially PHI, goes into Helix Hub. That is a **large** piece of work. The other items are small to medium.
