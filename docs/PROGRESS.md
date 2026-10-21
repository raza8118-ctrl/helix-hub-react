# Helix Hub – Build Progress & Handoff

**Read this first in every new session.** It records where the build is, what was decided and
what still has to be done, so work can continue even if a session ends mid-step.
Updated at the start of every step (approved plan) and at the end (result).

_Last updated: 2026-10-21 — step 7.5 (Medicare trackers) done; Phase 7 complete; next is 8.1._

---

## ⏯ How to resume (product owner)

1. Open the project folder `helix-hub` and start Claude Code there.
2. Paste: **“Read .claude/CLAUDE.md and docs/PROGRESS.md, then plan roadmap step 8.1.”**
3. Claude reads this file, fetches the latest code from GitHub, shows the 8.1 plan, and waits for your “go”.

Supabase: the product owner has run **no** migrations yet (decided 2026-10-20) and will run them all, one by one,
once the build is complete — from the ordered list under “Waiting on the product owner”, then **↻ Sync structure**.

---

## ▶ Current step

**8.1 – Payer bulletin PDF → AI extracts rows — plan approved 2026-10-21, building.**

Plan as approved (defaults: Claude Opus 5.5, medium effort, `fallbacks: "default"`; browser `fetch` like 5.3 — no SDK
dependency because package-lock can't be regenerated without Node; whole PDF sent as a document block; 100 pages /
30 MB; patient-word scan warns + second tick, doesn't block; upload = admin / manager):
- New sidebar page **📰 Payer Updates** (`wb_updates`, everyone). 8.1 = ⬆ Upload bulletin + 📋 Recent updates; full
  searchable list / Excel / notify is 8.2; directory suggestions 8.3.
- Upload (`payer_updates_edit`, admin/manager, grantable): PDF; required tick “payer bulletin with no patient
  information”; local pdf.js text scan for patient words (patient name, DOB, member ID, MBI, MRN, SSN, date of birth) →
  red warning with words + page and a second tick. ✨ Extract with AI → bulletin title / issuer / published date + rows
  (payer → Payer Directory match incl. aliases or “not in directory”, effective date, what changed, category Billing /
  claims · Authorization · Coding · Fee schedule / payment · Policy / coverage · Forms / portals · Credentialing ·
  Other, teams AR / Auth / Billing/Posting / Coding / Credentialing, action needed, source page). Review: edit / delete
  / add rows; missing effective date or payer highlighted; Save. PDF stored in a private bucket (signed links). Only the
  PDF + fixed instructions go to the AI; audit usage line (pages, rows, ok). No key → manual rows.
- 📋 Recent updates (everyone): latest bulletins + rows, Open PDF, filter by payer / team.
- DB: `supabase/migrations/20261021r_payer_updates.sql` → `payer_bulletins`, `payer_updates`, private bucket
  `payer-bulletins` (PDF, 30 MB).
- Files: new `src/lib/payerUpdates.js`, `src/pages/workbench/PayerUpdates.jsx`, `BulletinUpload.jsx`,
  `BulletinList.jsx`; changed `modules.js`, `WorkbenchApp.jsx`, `access.js`, `auditLabels.js`. Audit
  `bulletin_extract_ai`, `bulletin_save`, `bulletin_deactivate`.

### Reference: how 7.5 was built (done)

`src/lib/medicareTrackers.js`: `TRACKERS` config (adr / overpayment / rtp: table, ref prefix ADR / OP / RTP, statusKey,
closedKey, statuses with `done`, `statusDates` auto-filled on status change, `fields` with type client / payer / claim /
money / date / select / text and `from` + `days` for auto due dates), `statusOf`, `itemRef`, `isDone` (+ RTP `in_fiss`
false), `optionLabel`, `daysLeft`, `waitingDays`, `rtpAge` / `rtpBucket`, `quarterEnds`, `canManageMedicare` /
`canChangeItem`, `noteProblem`, `loadMedicare` (null until the migration), `loadItemEvents`, `checkItem`, `addItem`,
shared `change()` behind `editItem` / `assignItem` / `setItemStatus`, `addItemNote`, `clearOldMedicare`, RTP upload
`RTP_FIELDS` / `detectRtpColumns` (worklist `PHI_HEADER`, now exported) / `buildRtpRows` / `applyRtpUpload` (snapshot:
insert / update / back on list → new; missing → in_fiss false + resolved_at + “cleared_fiss” event).
UI: `MedicareTrackers.jsx` (tabs Overview / ADRs / Overpayments / RTP with open counts), `MedicareOverview.jsx` (tiles
open the tab; per client table; Excel without claim #), `MedicareTrackerList.jsx` (shared list — not in the original
file list: filters, status select, note, edit, owner, history; `badges` / `actions` / `sortKey` / `toolbar` props),
`MedicareItemEditor.jsx` (fields from config, auto due date until typed), `AdrTracker.jsx` (due / waiting badges, 📨 Ask
client for records → `addQuery` + status requested, ⚑ Escalate → `EscalationEditor`), `OverpaymentTracker.jsx` (refund
badges, 🗓 Quarter credit balances: Medicare-looking payers or none, open at quarter end, report due),
`RtpMonitor.jsx` (age × client table, top reason codes, “New on last upload”, ⬆ Upload FISS list for managers),
`RtpUpload.jsx` (client, file, column selects without patient columns, preview new / updated / cleared, dropped lists).
`modules.js` + `WorkbenchApp.jsx`: `wb_medicare`. `access.js`: `medicare_manage`.

Plan as approved (defaults: ADR due = letter + 45 days, warning at 10 days; refund due = identified + 60 days; credit
balance report due = quarter end + 30 days; RTP claims missing from a new upload auto-cleared; one page with tabs):
- New Workbench page **🏛️ Medicare Trackers** (`wb_medicare`, everyone), tabs 📊 Overview · 📄 ADR tracker ·
  💸 Overpayments & credit balances · 🔁 RTP / suspense monitor.
- **ADR**: client, MAC (payer), claim # optional, $ at risk, ADR letter date, response due (+45, “check current CMS
  rules”), records requested / received, submitted date + method (esMD / portal / fax / mail), decision + date. Status:
  ADR received → Records requested → Records received → Submitted → Decision (Approved / Partly / Denied) → Appealed /
  Closed. Badges due in N days / overdue / waiting on client N days. 📨 Ask client for records → Client Query (7.3,
  documentation) with the ADR ref; ⚑ Escalate → escalation (7.4).
- **Overpayments & credit balances**: kind (Payer overpayment / recoupment · Credit balance · Refund request), source
  (Payer letter · ERA offset WO / FB · Internal review · Credit balance report), client, payer, claim #, amount, reason
  (Duplicate · Secondary / MSP · Wrong payer · Rate / adjustment · Other), identified date, refund due (+60), refund
  method (check / offset / immediate recoupment), refunded date + amount. Status: Identified → Validated → Disputed /
  appealed → Refund requested → Refunded / offset → Closed. Quarter helper: Medicare credit balances open at a quarter end
  + report due date (CMS-838 prep).
- **RTP / suspense**: FISS / DDE Excel / CSV upload per client (claim / DCN, status-location e.g. T B9997 / S B6001,
  reason code, amount, date in status; patient columns dropped in the browser via the worklist `PHI_HEADER` and listed);
  snapshot → add / update, missing → “Cleared from FISS”; manual add; owner + work status (New · Working · Corrected /
  released · Cancelled · No action needed); age in status 0–2 / 3–7 / 8–14 / 15–30 / 30+, counts per reason / client,
  new since last upload.
- **Overview**: ADRs due ≤ 10 days / overdue + $ at risk; overpayments open $ + past 60 days; RTP by age + new /
  cleared since last upload; per client; Excel without claim #.
- Access: everyone views, adds ADRs / overpayments, updates own; `medicare_manage` (admin/manager/supervisor) uploads RTP,
  assigns, changes anyone's.
- PHI: minimum fields; notes via `phiIssues`; claim # / DCN wiped 90 days after closed / cleared.
- DB: `supabase/migrations/20261021q_medicare_trackers.sql` → `medicare_adrs`, `medicare_overpayments`,
  `medicare_rtp_uploads`, `medicare_rtp_items`, `medicare_events`.
- Files: new `src/lib/medicareTrackers.js`, `src/pages/workbench/MedicareTrackers.jsx`, `MedicareOverview.jsx`,
  `AdrTracker.jsx`, `OverpaymentTracker.jsx`, `RtpMonitor.jsx`, `RtpUpload.jsx`, `MedicareItemEditor.jsx`; changed
  `modules.js`, `WorkbenchApp.jsx`, `access.js`, `auditLabels.js`, `worklist.js` (export `PHI_HEADER` only). Audit
  `medicare_add/edit/status/assign/note/clear`, `rtp_upload` (ids / counts only).

### Reference: how 7.4 was built (done)

`src/lib/escalations.js`: `ESC_TYPES` (7), `ESC_SEVERITIES` (critical 0 / high 1 / medium 3 / low 3 working days),
`ESC_STATUSES` (open / in_progress / resolved / closed), `escRef` (E-0042), `targetFor`, `isOpenEsc`, `isOverdueEsc`,
`escAgeDays`, `canManageEsc` / `isMine` / `canChangeEsc`, `escTextProblem`, `loadEscalations` (null until the migration),
`loadEscEvents`, `loadEscalatedQueries` (7.3 queries with ⚑, open / waiting), `checkEsc`, `addEscalation` (+ “raised”
event), shared `change()` behind `editEscalation` / `assignEscalation` / `setEscStatus` (resolved needs resolution; closed
sets closed_at) / `reopenEscalation`, `addEscNote`, `clearOldEscalations`, `escSummary`. `src/lib/handover.js`:
`NOTE_FIELDS` (done / watch out / blockers), item statuses open / picked / done, `isEditable` (shift date ≥ yesterday),
`teamDates` (2), `checkHandover`, `handoverReady`, `loadMyHandover`, `loadHandovers(from, to, empIds)` (submitted only,
+ items + reads), `saveHandover` (items insert / update / removed → inactive), `markRead` (upsert), `pickItem`,
`doneItem`, `escalateItem` (escalation with `handover_item_id`, item gets `escalation_id`), `clearOldItems`.
UI: `HandoverEscalations.jsx` (tabs 📝 My handover / 📥 For my team (unread) / ⚑ Escalations (assigned open) / 📊
Overview for managers; team = `scopePeople` from `qa.js`), `HandoverForm.jsx` (today / yesterday; taken items locked),
`HandoverInbox.jsx` (✓ Mark as read; items 🙋 I'll take it / ✓ Done / ⚑ Escalate → `EscalationEditor` prefilled; managers see
“Read by”), `EscalationList.jsx` (views Assigned to me / Raised by me / All; filters; ▶ In progress / ✓ Resolve / Close /
Reopen / 📝 Note / ✏️ Edit / Goes to select; history; escalated client queries read-only + “Open Client Queries ›”),
`EscalationEditor.jsx` (`initial` + `create` props; supervisors / managers first), `HandoverOverview.jsx` (person × date
grid by team, carry-over not taken, open by type, overdue, Excel). `modules.js` + `WorkbenchApp.jsx`: `wb_handover`.
`access.js`: `escalations_manage`.

Plan as approved (defaults: handover per person; “For my team” = last 2 shift dates; target dates Critical same day /
High +1 working day / others +3; no sign-in pop-up, unread count on the tab; 7.3 escalated queries shown read-only):
- New Workbench page **🔁 Handover & Escalations** (`wb_handover`, everyone).
- **📝 My handover** (one per person per shift date): Done today, Carry over items (client, payer + claim # optional,
  what's left, Normal / Urgent), Watch out, Blockers; draft → Submit; editable until the end of the next day.
- **📥 For my team** (N unread): team handovers of the last 2 shift dates; ✓ Read (tracked); items 🙋 I'll take it /
  ✓ Done / ⚑ Escalate (→ escalation).
- **⚑ Escalations**: title, type (Payer issue · Client issue · System / software down · Access / login · Claim stuck ·
  Process question · Other), severity Low / Medium / High / Critical, client / payer / claim # optional, details, raised
  by, assigned to, target date; Open → In progress → Resolved (resolution) → Closed, Reopen; history; views Raised by me /
  Assigned to me / All (`escalations_manage` admin/manager/supervisor); filters; overdue badge; escalated client queries
  read-only with “Open in Client Queries”.
- **📊 Overview** (managers / supervisors): handover submitted per person per team per date, carry-over not picked up,
  open escalations by age / type, overdue, average time to resolve; Excel without claim #.
- PHI: all text through `phiIssues`; claim # wiped 90 days after item done / escalation closed.
- DB: `supabase/migrations/20261021p_handover_escalations.sql` → `handovers`, `handover_items`, `handover_reads`,
  `escalations`, `escalation_events`.
- Files: new `src/lib/handover.js`, `src/lib/escalations.js`, `src/pages/workbench/HandoverEscalations.jsx`,
  `HandoverForm.jsx`, `HandoverInbox.jsx`, `EscalationList.jsx`, `EscalationEditor.jsx`, `HandoverOverview.jsx`; changed
  `modules.js`, `WorkbenchApp.jsx`, `access.js`, `auditLabels.js`. Audit `handover_submit/edit/read`,
  `handover_item_pick/done`, `escalation_add/edit/assign/status/reopen/clear` (ids only).

### Reference: how 7.3 was built (done)

`src/lib/clientQueries.js`: `QUERY_CATEGORIES` (8), `QUERY_STATUSES` (open / waiting / answered / closed / cancelled),
`ASKED_VIA`, `AGE_BUCKETS` (0–2 / 3–7 / 8–14 / 15–30 / 30+), `queryRef` (Q-0042), `addWorkdays`, `isOpen`, `ageDays`
(asked → answered / closed, or today), `ageBucket`, `isOverdue` (past expected date), `chaseDue` (3 working days since
asked / last chased), `canManageQueries` / `canChange` (owner, creator or `queries_manage`), `textProblem` (`phiIssues`),
`loadQueries` (paged; null until the migration), `loadEvents`, `checkQuery`, `addQuery` (+ “asked” event), shared
`change()` (update + event + audit) behind `editQuery` / `chaseQuery` (→ waiting, count + 1) / `answerQuery` /
`closeQuery` / `cancelQuery` / `reopenQuery` / `escalateQuery` / `assignQuery`, `addNote`, `clearOldQueries` (claim #
wiped 90 days after `closed_at`; run on page open), `chaseMessage` (ref, contact, category, asked date, question),
`agingBy` (client or owner). UI: `ClientQueries.jsx` (tabs My queries (N · M to chase) / All queries / Aging; + New
query → “Logged as Q-…” pop-up), `QueryEditor.jsx`, `QueryList.jsx` (filters; needs-attention sort; row badges overdue /
chase due / urgent / escalated; actions 📨 Chase pop-up with Copy + Mark as chased, ✓ Answered, Close, Cancel, Reopen,
⚑ Escalate / remove, 📝 Note, ✏️ Edit, owner select for managers; history timeline), `QueryAging.jsx` (totals, client ×
age table, owners, Excel). `modules.js` + `WorkbenchApp.jsx`: `wb_queries`. `access.js`: `queries_manage`. People list via
`loadPeople` from `qa.js`.

Plan as approved (defaults: strict `phiIssues` check on question / answer / notes (dates blocked too); chase every 3
working days; everyone sees all queries, changes only their own; no sidebar badge):
- New Workbench page **💬 Client Queries** (`wb_queries`, everyone). New query: client, team, category (Documentation ·
  Authorization · Demographics / insurance · Coding · Billing hold · Credentialing · Payment / refund · Other), priority
  Normal / Urgent, payer + claim # (optional), question, asked via (email / portal / call / meeting), asked on, expected
  answer (+3 working days), owner (me), client contact name. Reference **Q-0042**.
- **My queries** (chase-due / overdue first): 📨 Chase (copy-ready message, logged), ✓ Answered (summary), Close, Cancel,
  Reopen, ⚑ Escalate; history timeline.
- **All queries**: search + filters client / status / category / owner / age; `queries_manage` (admin/manager/supervisor)
  reassigns and acts on anyone's.
- **📊 Aging**: per client open by age 0–2 / 3–7 / 8–14 / 15–30 / 30+, overdue, escalated, average days to answer; per
  owner open / overdue; Excel without claim #.
- Statuses: open → waiting (on client) → answered → closed, or cancelled; reopen. Chase due = unanswered and 3 working
  days since asked / last chased.
- PHI: minimum fields; texts checked with `phiIssues`; claim # wiped 90 days after closing; chase message = reference,
  client, category, asked date, question.
- DB: `supabase/migrations/20261021o_client_queries.sql` → `client_queries`, `client_query_events` (query_id, kind,
  note, emp_id, created_at).
- Files: new `src/lib/clientQueries.js`, `src/pages/workbench/ClientQueries.jsx`, `QueryEditor.jsx`, `QueryList.jsx`,
  `QueryAging.jsx`; changed `modules.js`, `WorkbenchApp.jsx`, `access.js`, `auditLabels.js`. Audit
  `query_add/edit/chase/answer/close/cancel/reopen/escalate/assign` (ids only).

### Reference: how 7.2 was built (done)

`src/lib/mistakes.js`: `SEVERITIES`, `TEXT_FIELDS` (what goes wrong / why it matters / fix steps / how to avoid),
`canEditMistakes` (`mistakes_edit` or QA flag), `stepsOf` (one step per line), `needsRecheck` (180 days),
`loadMistakes` (null until the migration), `seenCounts` (failed, not overturned QA checkpoints with `mistake_id`, work
date last 90 days), `filterMistakes` (words in title / code / text; client / payer filters keep general entries; high
first), `checkMistake` (`phiIssues` on title + text fields), `addMistake` (non-editors → `suggested`), `editMistake`,
`publishMistake`, `verifyMistake`, `setMistakeActive`, `STARTER_MISTAKES` (8, linked to the 7.1 starter categories by
name) + `addStarterMistakes` / `missingStarterMistakes`. UI: `ErrorLibrary.jsx` (exports `MistakeDetails`; filters team
(own team preselected) / category / client / payer (only payers with entries) / severity; editors: Published / Suggestions
/ All, show turned-off, Edit / Publish / ✓ Mark checked today / Turn off), `MistakeEditor.jsx`. QA changes (additive):
`QaAudits.jsx` (loads mistakes + seen counts; 📖 tab for everyone), `QaAuditForm.jsx` (“Known mistake” on a fail, same
category first, fills the SOP if empty), `MyQaAudits.jsx` (📖 How to fix pop-up), `QaResults.jsx` (most common known
mistakes). `access.js`: `mistakes_edit`.

Plan as approved (defaults: a tab on QA Audits, not its own sidebar page; everyone can suggest; QA flag can edit;
180-day re-check):
- QA Audits tab **📖 Mistakes & fixes** (everyone). Entry: title, team, QA error category, severity Low / Medium / High,
  What goes wrong, Why it matters, How to fix it now (numbered steps), How to avoid it; optional SOP (📚), client, payer,
  denial code (→ Denial Navigator); “✓ Checked” date + re-check badge after 180 days; “Seen in QA in the last 90 days: N”.
- Search + filters: team, category, client, payer, severity.
- QA link (no DB change — saved in `qa_audits.results`): failed checkpoint → optional “Known mistake” (`mistake_id`);
  My audits shows 📖 How to fix; Results gains “Most common known mistakes”.
- Permission `mistakes_edit` “Edit error library” (admin/manager + QA flag, grantable). Everyone can 💡 Suggest →
  review list → editors publish or turn off. Never deleted. “Add starter entries” (~8, our wording).
- PHI: every text field checked with `phiIssues`; entries never tied to a specific claim.
- DB: `supabase/migrations/20261021n_error_library.sql` → `qa_mistakes` (id, title, team, category_id, severity,
  what_happened, why_it_matters, fix_steps, prevent_steps, sop_id, client_id, payer_id, denial_code, status
  suggested/published, suggested_by, verified_at/by, active, created/updated).
- Files: new `src/lib/mistakes.js`, `src/pages/workbench/ErrorLibrary.jsx`, `MistakeEditor.jsx`; changed `QaAudits.jsx`,
  `QaAuditForm.jsx`, `MyQaAudits.jsx`, `QaResults.jsx`, `access.js`, `auditLabels.js`. Audit
  `mistake_add/edit/suggest/publish/verify/activate/deactivate` (ids only).

### Reference: how 7.1 was built (done)

`src/lib/qa.js`: `QA_STATUSES` (queued → draft → sent → acknowledged | disputed → resolved), `RESULTS`, `canAudit`
(`qa_audit` or `users.is_qa`), `canManageQa`, `seesEveryone` / `scopePeople` (supervisors: team + supervisees; never
yourself), `loadPeople` (falls back without team / is_qa), `newResults` (copy of the checkpoints), `failed`, `scoreOf`
(passed weight ÷ checked weight, 1 decimal, critical fail → 0), `commentProblem` (`phiIssues` from `appealAI.js`),
`qaReady`, `loadQaSetup`, `loadAudits` (paged) / `loadMyAudits`, `saveAudit` (draft / send), `acknowledgeAudit`,
`disputeAudit`, `resolveDispute` (ticked fails overturned, score recalculated), `setAuditActive` (Skip), `clearOldAudits`
(claim # wiped 90 days after `closed_at`; run when an auditor opens the page), sampling `loadWorkedClaims` (worklist items
worked in the range, not yet picked) / `pickSample` (per person, count or %, Fisher–Yates) / `queueSample`, results
`summarise` / `errorCounts`, starters (`STARTER_QA_CATEGORIES` 10, `STARTER_SCORECARDS` AR follow-up / Payment posting /
Authorization / Charge entry) + `addQaStarters`, `saveQaItem` / `setQaItemActive` / `moveCheckpoint`.
UI: `QaAudits.jsx` (tabs 🔍 Audit: disputes to resolve, my drafts, sampled queue with Start / Skip, + New audit;
🙋 My audits (N waiting); 🎲 Sampling; 📊 Results; 🗂 Scorecards & categories), `QaAuditForm.jsx` (agent → team scorecard
suggested; pass / fail / N/A; fail → category + SOP + comment; live score), `MyQaAudits.jsx` (`AuditDetails`,
`ResolveModal`, acknowledge / dispute; 📚 Read the SOP → `openSopLibrary(title)`), `QaSampling.jsx`, `QaResults.jsx`
(date range + team, by person, errors by category, SOPs linked to errors, waiting / disputed, Excel without claim #),
`QaScorecards.jsx`. `modules.js` + `WorkbenchApp.jsx`: `wb_qa`. `access.js`: `qa_audit` (admin/manager/supervisor),
`qa_manage` (admin/manager). Daily Report / Quality Monitor untouched.

Plan as approved (defaults: QA scores do NOT fill the Daily Report quality %; short comments allowed with the no-PHI
warning + DOB / member-ID-looking text blocked; supervisors audit their own team; pass mark 95%; critical fail = 0):
- New Workbench page **✅ QA Audits** (`wb_qa`). Daily Report quality entry + Quality Monitor untouched.
- **New audit** (QA flag `users.is_qa` + admin/manager + supervisors for own team; `qa_audit`): agent, scorecard, client,
  payer, claim #, work date; checkpoints ✓ / ✗ / N/A; fail → error category + linked SOP (default from checkpoint);
  score = passed weight ÷ checked weight, critical fail → 0; draft or Send to agent.
- **Sampling:** team / person + date range + N claims or N% → random pick of claims they worked in the Smart Worklist →
  audit queue; manual audits for non-worklist work.
- **My audits** (everyone): score, errors, 📚 Read the SOP; ✓ Acknowledge or Dispute with a reason; QA / manager resolves
  Upheld / Overturned (overturned checkpoint → pass, score recalculated).
- **Results** (managers, supervisors for their team): per person count / average / pass rate / fatal; errors by category;
  most-linked SOPs; waiting acknowledgement; open disputes; Excel.
- **Scorecards & categories** (`qa_manage`, admin/manager): scorecards per team (checkpoints: text, weight, critical,
  default category, SOP; pass mark), error categories; “Add starter scorecards” (AR follow-up, Payment posting, Auth,
  Charge entry); inactive, never deleted.
- PHI: minimum fields only; claim # wiped 90 days after the audit is closed.
- DB: `supabase/migrations/20261021m_qa_audits.sql` → `qa_categories`, `qa_scorecards`, `qa_checkpoints`, `qa_audits`
  (results jsonb, score, passed, fatal, status draft/sent/acknowledged/disputed/resolved, ack / dispute / resolution,
  cleared…).
- Files: new `src/lib/qa.js`, `src/pages/workbench/QaAudits.jsx`, `QaAuditForm.jsx`, `QaSampling.jsx`, `MyQaAudits.jsx`,
  `QaResults.jsx`, `QaScorecards.jsx`; changed `modules.js`, `WorkbenchApp.jsx`, `access.js`, `auditLabels.js`.
  Audit `qa_audit_add/send/ack/dispute/resolve`, `qa_scorecard_*`, `qa_category_*` (ids only).

### Reference: how 6.6 was built (done)

`src/lib/portals.js`: `PORTAL_GROUPS` (software / payer / custom), `cleanUrl` (adds https://, refuses non-http and
user:password@ links), `mentionsSecret` (password / passwd / passcode / pwd / “pin:” / `?pass=`…), `needsRecheck`
(180 days), `loadLaunchpad` (`client_portals` = null until the migration; SOP software / tasks / sops; Payer Directory
contacts with a portal), `directoryPortal` (claims department first), `buildTiles` (managed rows for the client + all-client
rows; empty url = standard link; fallback = every software login link + one portal per payer), stars in `localStorage`
`hh_portal_stars_<emp_id>`, `sortTiles` (stars → sort_order → name), `checkPortal`, `addPortal` (marked checked on add) /
`editPortal` / `verifyPortal` / `setPortalActive` / `movePortal`. UI: `PortalLaunchpad.jsx` (client remembered in
`hh_portal_client`, search, 3 group cards with tile grid, Open ↗ / Copy link / 📚 How-to (N) / 🔑 access note; managers:
✏️ Edit, ✓ Link checked, ↑ ↓, Turn off / on, Show turned-off links), `PortalEditor.jsx`. `ARTools.jsx`: 🚀 Portal launchpad
tool. `sops.js` + `SopLibrary.jsx` (3 lines, additive): `openSopLibrary(query)` / `peekSopLibrarySearch` → the library
opens with the software name searched. `access.js`: `portals_edit`. Audit `portal_add/edit/verify/activate/deactivate`.

Plan as approved (defaults: portal opens not logged; ⭐ favourites in the browser only; 180-day link re-check; no
“Open all” because browsers block several pop-ups):
- AR Tools **🚀 Portal launchpad** (everyone). Pick a client → tiles in 3 groups: **Client software** (from the SOP
  Library; a client-specific link overrides the standard one), **Payer portals** (payer + Payer Directory portal link or
  a client-specific one), **Other links** (custom name + URL). “All clients” links show for every client.
- Tile: Open ↗ (new tab), Copy link, 📚 How-to (linked SOP for that software, opens the SOP Library), plain access note
  (“ask supervisor; MFA goes to the team phone”). No password field; notes with “password / pwd / pin:” can't be saved.
- ⭐ per-person favourites first (localStorage); search box; “✓ Link checked” date, “re-check” badge after 180 days.
- Permission `portals_edit` “Manage portal links” (admin/manager, grantable): tick software, add payers, add custom
  links, order, turn off (never deleted).
- Before the migration: read-only list of every SOP software login link + every Payer Directory portal link, with a
  “not set up yet” note.
- DB: `supabase/migrations/20261021l_client_portals.sql` → `client_portals` (id, client_id null = all clients, kind
  software/payer/custom, software_id, payer_id, label, url, access_note, sort_order, verified_at/by, active,
  created/updated). No credentials, no PHI.
- Files: new `src/lib/portals.js`, `src/pages/workbench/PortalLaunchpad.jsx`, `PortalEditor.jsx`; changed `ARTools.jsx`,
  `src/lib/access.js`, `src/lib/auditLabels.js`. Audit `portal_add/edit/verify/activate/deactivate` (ids only).

### Reference: how 6.5 was built (done)

`src/lib/followups.js`: `REMINDER_ACTIONS`, `BUCKETS` + `bucketOf`, `snoozeOptions` (+1 / +3 working days, next Monday),
`followupsReady`, `loadMyFollowups` (open reminders + own worklist items with a follow-up that aren't finished),
`dueCounts`, `addReminder`, `markDone` (reminder → done; worklist item → chosen status via `updateItem`, follow-up cleared
unless finished), `snooze`, `clearOldReminders` (claim # wiped 90 days after done / due; run when the tab opens),
`teamCounts`, `helix:followups-changed` event, `openFollowups` / `peekOpenFollowups` (in-memory flag → Smart Worklist opens on
⏰ Follow-ups), notification preference (`localStorage` `hh_followup_notify`, browser permission). UI: `Followups.jsx`
(stats, by date / by payer with claims phone, rows with done-as status / snooze / date / 📝 Note, 🔔 switch, team table +
Excel), `ReminderModal.jsx`, `FollowupNudge.jsx` (sign-in pop-up once per day per session, 15-minute `dueCounts`, browser
notification when the count rises; counts only). `App.jsx` (7 lines): `followupDue` state, `<FollowupNudge>`, “Smart
Worklist (N)” label via `sidebarTabs`. `SmartWorklist.jsx`: ⏰ Follow-ups tab for everyone; clients/payers loaded for all.
`ClaimNoteGenerator.jsx`: “⏰ Also add a reminder” (action guessed from the note; optional claim #).

Plan as approved (defaults: buckets overdue / today / this week / later; snooze +1 day · +3 days · next Monday · pick a
date; sign-in pop-up on; browser notifications off until each person turns them on; 15-minute refresh; 90-day claim # wipe):
- Smart Worklist **⏰ Follow-ups** tab (everyone, own only): worklist follow-up dates + personal reminders; counts;
  group by payer (payer claims phone + copy); actions ✓ Done (worklist status for worklist claims), Snooze, 📝 Write note,
  copy claim #.
- **+ Reminder**: client, payer, what to do (call back, check status, expect payment, expect records request, appeal
  decision due, other), due date, optional claim #. Claim Note Generator: “⏰ Also add a reminder” when a follow-up date is
  set (optional claim #). No free text; no patient fields.
- Reminding (in the app; no email/SMS — no server): sign-in pop-up “N due today, M overdue → Open”; sidebar badge on
  “Smart Worklist (N)” refreshed every 15 min; optional per-person browser notifications while Helix Hub is open (count
  only, never claim details). `App.jsx` additive only (nudge, 15-min count, badge on that one label).
- Team view (`worklist_manage`; supervisors own team): per person overdue / due today / done today; Excel counts only.
- PHI: reminder claim # wiped 90 days after done (or after the due date if never done); rows kept.
- DB: `supabase/migrations/20261021k_followups.sql` → `followups` (id, emp_id, client_id, payer_id, claim_number,
  action, due_date, status open/done, snoozed_count, done_at, cleared, created/updated). No patient / free-text columns.
- Files: new `src/lib/followups.js`, `src/pages/workbench/Followups.jsx`, `ReminderModal.jsx`,
  `src/components/shared/FollowupNudge.jsx`; changed `SmartWorklist.jsx`, `ClaimNoteGenerator.jsx`, `src/App.jsx`
  (additive), `src/lib/auditLabels.js`. Audit `followup_add/done/snooze/clear` (ids only).

### Reference: how 6.4 was built (done)

`src/lib/worklist.js`: `FIELDS` + header patterns, `PHI_HEADER` (patient / member / DOB / MRN / SSN / address / phone /
name / MBI / account # …), `detectColumns`, `droppedColumns` {patient, other}, `toDate` / `toMoney`, `readWorklistFile`
(rows stay in memory), `matchPayerName` (score ≤ 1, cached per name), `buildItems` (minimum fields only), `addDeadlines`
(AFL from denial date else TFL from DOS via `loadPayerInfo` limits incl. client override; level 1 / no plan preferred),
`prioritise` (computed in the browser: deadline 100/90/75/55/35/15 or aging fallback, balance percentile via binary
search, starred payer 100; weights 0–3; bands ≥ 70 high / ≥ 40 medium; reason text), `ITEM_STATUSES`, `isDone`,
`loadWorklists`, `loadItems` (1,000-row pages), `saveWorklist` (500-row inserts), `assignItems` (200 ids per update),
`planSplit` (count round-robin / dollars greedy), `updateItem` (non-“new” status → worked_at / worked_by),
`closeAndClear` (wipes claim_number / dos_from / dos_to, cleared = true), `dueForClearing` (90 days), `workedCounts`.
Stored `priority_score` / `band` / `reason` columns are left empty (priority is always computed live).
UI: `SmartWorklist.jsx` (tabs; auto-clear due lists on a manager's load; supervisors see their team's / own / team-less
lists and assign to their team or supervisees), `WorklistUpload.jsx`, `WorklistManage.jsx` (progress, weights + starred
payers saved on the worklist, filters, tick / assign / unassign, auto-split, Excel, close & clear), `MyWorklist.jsx`
(stats, due follow-ups first, status + follow-up, 📝 Write note → `startClaimNote` prefill in `claimNotes.js`).
`ProdReport.jsx` (32 added lines): `workedCounts` banner with “Add to my counts” per task (not for Legacy Auth; only when
editable). `modules.js` + `WorkbenchApp.jsx`: `wb_worklist`.

PO decisions (2026-10-20): **no BAA with Supabase → store minimum fields only** (never patient name / DOB / member ID /
MRN / address); **new page beside Work Allocation** (Work Allocation / My Allocation untouched); **production counts =
suggest, user confirms** in the Daily Report.

Plan as approved (defaults: bands with equal weights; auto-split by count; 90-day auto-clear; statuses below; supervisors
manage worklists for their own team):
- New Workbench page **📋 Smart Worklist** (`wb_worklist`, all roles). Managers (`worklist_manage`: admin/manager/
  supervisor) upload / prioritise / assign; everyone sees **My worklist** (own claims only).
- Upload Excel/CSV: auto-matched columns (claim #, client, payer → Payer Directory incl. aliases, DOS from/to, billed,
  balance, aging days, denial date, last billed, status/reason); patient-identifying + unneeded columns are dropped and
  listed in the preview; worklist name, client, Daily Report task it counts towards.
- Priority score + band 🔴/🟠/🟢 with reason: deadline (TFL from DOS / appeal from denial date via payer/client limits,
  4.4), balance $, starred payers; three weight sliders; sort/filter by band, payer, aging, status.
- Assign: tick → person, or auto-split among chosen people by count or by $ (highest priority first); reassign/unassign.
- My worklist: priority order; status (Worked – follow-up · Appealed · Rebilled / corrected · Paid · Denied – no
  further action · Closed) + follow-up date; worked statuses count as “worked today”; follow-ups due / overdue on top;
  “📝 Write note” opens the AR Tools Claim Note Generator with payer + client prefilled; no free-text notes stored.
- Progress (managers): per person assigned / worked today / remaining / overdue follow-ups; Excel export (stored fields only).
- Daily Report (`ProdReport.jsx`, additive banner only): “From your Smart Worklist today: N claims worked → <task>.
  Add to my counts” fills the form field; saved only when the user saves the report as usual.
- PHI hygiene: on close or automatically 90 days after upload, claim # and DOS are wiped (rows kept; status / counts /
  $ totals kept); manager “Close & clear details”. Limits: no BAA, app-enforced access (no DB row rules) — noted.
- DB: `supabase/migrations/20261021j_worklists.sql` → `worklists` (id, name, client_id, count_task, weights, starred
  payers, status open/closed, uploaded_by/at, closed_at, cleared_at, created/updated), `worklist_items` (id, worklist_id,
  claim_number, payer_id, payer_name, client_id, dos_from, dos_to, billed, balance, aging_days, denial_date, last_billed,
  deadline, deadline_type, priority_score, band, reason, assigned_to, status, follow_up, worked_at, worked_by, cleared,
  active). No patient columns.
- Files: new `src/lib/worklist.js`, `src/pages/workbench/SmartWorklist.jsx`, `WorklistUpload.jsx`, `WorklistManage.jsx`,
  `MyWorklist.jsx`; changed `modules.js`, `WorkbenchApp.jsx`, `src/lib/access.js`, `src/lib/auditLabels.js`,
  `src/pages/employee/ProdReport.jsx` (banner only), `ClaimNoteGenerator.jsx` (prefill). Audit `worklist_upload`,
  `worklist_assign`, `worklist_item_status` (id only), `worklist_close_clear` — never claim numbers.

### Reference: how 6.3 was built (done)

`src/lib/refCodes.js`: `CODE_SETS`, `normRef` (upper, ICD-10 without dot, revenue padded to 4), `displayRef`,
`detectCode` (3–4 digits → revenue, [1-4][A-L][A-C][1-3](1) → HIPPS, ICD-10-CM shape → icd10), `decodeHipps` (HH PDGM
positions; clinical group letters A MMTA-Other, B Neuro, C Wound, D Complex nursing, E MS rehab, F Behavioral, G–L MMTA
subgroups — labelled “verify against the CMS HIPPS table”), `searchRefCodes` (DB: code prefix `ilike` or every word in
the description, limit), CRUD + verify/(re)activate, import: `readRefFile` (CMS .txt “CODE  description” lines, or
xlsx/csv Code + Description), `compareRefImport` (pages the whole set 1,000 at a time), `applyRefImport` (500-row
inserts, updates, optional retire via `.in(ids)`), `STARTER_REVENUE` (24, our wording). UI: `CodeLookup.jsx` (AR Tools
tool; chips; 300 ms debounced DB search; CARC/RARC from the Denial library client-side with “Open in Denial Navigator”
via `helix:open-tab`; HIPPS decoder card), `RefCodeEditors.jsx` (add/edit, import with preview + retire tick).

Plan as approved (defaults: HIPPS decoded by rule, HH PDGM only; revenue descriptions in our words + import; ICD-10
from the CMS file yearly; missing codes marked retired only when ticked; new permission admin/manager):
- AR Tools **🔎 Code lookup** (everyone): one box + chips All / CARC-RARC / Revenue / HIPPS / ICD-10; detects 0551 →
  revenue, 1FC21 → HIPPS, I50.9 / I509 → ICD-10, CO-16 / N290 → CARC/RARC, words → description search; copy button,
  retired badge, 50 + Show more; nothing saved / logged.
- CARC/RARC: read-only search of the Denial library + “Open in Denial Navigator ›”.
- HIPPS (HH PDGM): built-in decoder (1 admission source + timing, 2 clinical group A–L, 3 functional level A–C,
  4 comorbidity 1–3, 5 fixed); “check current CMS rules”; imported HIPPS descriptions shown too.
- Revenue codes: NUBC wording not bundled; “Add starter revenue codes” (~25 HH/hospice codes, our wording, verify);
  import of a licensed list.
- ICD-10-CM: import the free CMS `icd10cm-codes-YYYY.txt` (code + description) or Excel/CSV; preview new / changed /
  unchanged / not in this file; optional “mark missing as retired”; nothing deleted; search in the database.
- Permission `ref_codes_edit` “Manage code lists” (admin/manager). DB: `supabase/migrations/20261021i_ref_codes.sql` →
  `ref_codes` (id, code_set revenue/hipps/icd10, code, description, notes, source, list_year, retired, verified_at/by,
  active, created/updated), unique set+code, search indexes. No PHI.
- Files: new `src/lib/refCodes.js`, `src/pages/workbench/CodeLookup.jsx`, `RefCodeEditors.jsx`; changed `ARTools.jsx`,
  `src/lib/access.js`, `src/lib/auditLabels.js`. Audit `ref_code_add/edit/verify/activate/deactivate`, `ref_code_import`,
  `ref_code_starter_add`; searches never logged.

### Reference: how 6.2 was built (done)

No database change, no audit. `src/lib/medicareCalc.js`: `nextBusinessDay`, `noaResult(from, submitted, payment)`
(due = From + 5; late → `lateDays` = From → submission, `reduction` = payment/30 × days, capped), `pdgmPeriods(soc, 6)`
(30-day periods, early = 1st, cert = pairs of 60 days, recert window last 5 days), `lupaResult`, `noeResult(election,
accepted)` (due = election + 5; late → non-covered = election → day before acceptance), `hospicePeriods` (90/90/60…, F2F
from period 3 within 30 days before), `paymentResult` (deductible + copay + coinsurance % of remainder = patient; payer
before sequestration; sequestration %; net; difference vs actually paid), `usd`. UI tools in `ARTools.jsx`:
`DeadlineTool.jsx` (client select + PayerSearch around `DeadlineHelper` always open), `HomeHealthCalc.jsx` (exports
`RuleNote`), `HospiceCalc.jsx`, `PaymentCalc.jsx`; each has 📋 Copy result.

Plan as approved (defaults: weekend note only, no holiday calendar; 6 PDGM periods; LUPA threshold typed by hand; 2%
sequestration preset; everything labelled “check current CMS rules”) — no database change, no audit:
- AR Tools bar gains **⏰ Filing & appeal deadlines**, **🏠 Home health**, **🕊️ Hospice**, **💲 Expected payment**;
  each has 📋 Copy result; nothing saved or logged.
- Deadlines: the 4.4 Deadline helper with client + payer pickers (Medicare / by-hand work without a payer).
- Home health: NOA due = From date + 5 calendar days (weekend → note CMS allows next business day); optional submitted
  date → days late + reduction rule (1/30 of the 30-day period payment per day from the From date until submission) and $
  estimate from an optional period payment. PDGM: SOC → periods 1–6 (start/end, early = 1st / late = later), 60-day cert
  periods with recert window days 56–60, note that a > 60-day gap starts a new sequence. LUPA: threshold (2–6) + visits →
  LUPA / not, visits needed.
- Hospice: NOE due = election + 5 calendar days (weekend note); optional accepted date → non-covered days (election to the
  day before acceptance). Benefit periods 90 / 90 / 60…; face-to-face flag from period 3 (within 30 days before start).
- Expected payment: billed, allowed, deductible, coinsurance % or copay $, sequestration % (2% default, off for
  non-Medicare) → contractual adjustment, patient responsibility, payer payment, sequestration, expected net; optional
  actually paid → under / over.
- Files: new `src/lib/medicareCalc.js`, `src/pages/workbench/HomeHealthCalc.jsx`, `HospiceCalc.jsx`, `PaymentCalc.jsx`,
  `DeadlineTool.jsx`; changed `ARTools.jsx`.

### Reference: how 6.1 was built (done)

`src/lib/claimNotes.js`: `ACTIONS` (8), `STATUSES` (text, fields, follow-up days: partial +7, denied +3, in process +14,
no claim +2, pending +7), `STATUS_FIELDS`, `NEXT_STEPS`, `DATE_STYLES` + `formatDate`, `suggestFollowUp`, `emptyNote`,
`NOTE_TOKENS` ({DATE} {USER} {CLIENT} {PAYER} {PHONE} {ACTION} {REP} {REF} {STATUS} {STATUS_DETAILS} … {EXTRA}),
`noteValues` (status details composed: paid amount/date/check, denied codes + reason, ETA, needs), `buildNote` (`[ … ]`
groups dropped when any token inside is empty; tidies spaces / doubled punctuation / stray dashes; ALL CAPS option),
`pickFormat` (client +4, action +2), `checkFormat`, CRUD, `STARTER_FORMATS` (8, one per action; `NEXT` tail shared).
UI: `ARTools.jsx` (tool bar; built-in standard format used when the table is missing or empty), `ClaimNoteGenerator.jsx`
(payer phones from `payer_contacts` claims first via datalist; denial reason = first sentence of the first known code;
character counter vs `max_length`; 📋 Copy note keeps the last 5 in component state), `NoteFormats.jsx` (grouped by client;
editor with options, placeholder buttons, sample preview, warnings; copy / review / (re)activate; starter).

Plan as approved (defaults: actions / statuses / follow-up suggestions below; initials from the user's name; date style
10/20/26; last 5 notes in memory only; no per-note audit; new permission admin/manager):
- **🧮 AR Tools** (`wb_artools`, replaces placeholder; everyone) with a tool bar like File Tools; first tool
  **📝 Claim Note Generator**.
- Inputs: client, payer (claims phone from the Payer Directory + copy); action (Called payer / Checked portal or
  clearinghouse / Submitted or rebilled / Sent corrected claim / Sent appeal or recon / Sent records or requested info /
  Escalated / Write-off or adjustment request); claim status driving fields (Paid: amount, date, check/EFT #; Denied:
  codes checked against the Denial library + plain reason; In process: expected time; No claim on file; Pending info:
  what's needed; Partially paid); call details (rep, ref #, phone); next step dropdown + follow-up date suggested from the
  status (in process +14, pending info +7…); extra note with no-patient-details reminder.
- Note built instantly in the client's format; 📋 Copy note, character counter vs the format's max length, ↺ New note;
  nothing saved / logged / in browser storage; last 5 re-copyable while AR Tools is open; no audit per note.
- **📚 Note formats** tab (`note_formats` “Manage claim note formats”, admin/manager): client (or all) + action (or any) +
  body with `{PLACEHOLDERS}`; options date style (10/20/26, 10/20/2026, 2026-10-20), ALL CAPS, max length, initials vs full
  name; `[ … ]` drops when its placeholder is empty; best match client+action → client → all; live preview with made-up
  values; “Add standard formats” (3Gen default per action, “please review”). No patient-name placeholder exists.
- DB: `supabase/migrations/20261021h_note_formats.sql` → `note_formats` (id, name, client_id, action, body, date_style,
  upper_case, max_length, name_style, source, reviewed_at/by, active, created/updated).
- Files: new `src/lib/claimNotes.js`, `src/pages/workbench/ARTools.jsx`, `ClaimNoteGenerator.jsx`, `NoteFormats.jsx`;
  changed `WorkbenchApp.jsx`, `src/lib/access.js`, `src/lib/auditLabels.js`. Audit only format changes
  (`note_format_add/edit/review/activate/deactivate`, `note_starter_add`).

### Reference: how 5.5 was built (done)

No database change. `src/lib/packetHandoff.js` (module-level `handoff`, `sendToPacket` fires `helix:open-tab` →
`wb_files`, `peekPacketHandoff`, `clearPacketHandoff`, wiped on `helix:signed-out`). `appealPdf.js`: `buildLetterPdf(text,
{ pageNumbers })`, `buildFormPart`. `AppealPdf.jsx`: “📦 Add to Appeal Packet” (after the deadline tick; letter without
page numbers + form part with page counts; DOS as MM/DD/YYYY–MM/DD/YYYY; level → packet type; audit `appeal_to_packet`
{letter, form}). `FileTools.jsx`: starts on `packet` when a hand-over waits. `AppealPacket.jsx`: state starting values
from `peekPacketHandoff()` (type, payer, client, claim #, DOS, patient, member ID; letter/form files keyed `h-letter` /
`h-form`), effect clears the hand-over and loads the payer's contacts/forms, “Started from the Appeal Builder” note.
Plan deviation: no Replace / Add question — File Tools always opens fresh, so the packet is empty when the hand-over arrives.

Plan as approved (defaults: no fax cover in the packet; letter without its own page numbers; ask Replace / Add when the
packet isn't empty; deadline tick reused) — no database change:
- Appeal Builder 📄 Build the PDF gets **📦 Add to Appeal Packet** (same past-due / ≤ 3 days “I understand” tick first).
- Hands over: cover letter PDF (no own page numbers) → packet *Cover letter*; payer form (pre-filled / flattened as
  chosen) → *Appeal / Recon form*; fields payer (loads its contacts + forms), client, claim #, DOS (`MM/DD/YYYY–MM/DD/YYYY`),
  patient name, member ID, packet type (first/second → Appeal, recon → Reconsideration, corrected → Corrected claim).
  The 5.4 fax cover is not handed over (the packet has its own cover sheet).
- Switches to File Tools → Appeal Packet with a “Started from the Appeal Builder…” note; if the packet already has files:
  Replace or Add.
- PHI: hand-over in memory only (no DB / browser storage / logs), wiped once picked up and on sign-out; packet cover sheet
  still shows patient / member / claim (2.5 design; can be unticked). Audit `appeal_to_packet` counts only.
- Files: new `src/lib/packetHandoff.js`; changed `AppealPdf.jsx`, `src/lib/appealPdf.js`, `AppealPacket.jsx` (additive:
  picks up a waiting hand-over), `FileTools.jsx` (opens on Appeal Packet when one is waiting), `src/lib/auditLabels.js`.

### Reference: how 5.4 was built (done)

`src/lib/appealPdf.js` (pdf-lib, lazy): `buildLetterPdf` (Times 12 pt, 1" margins, word wrap + hard-break of long words,
“Page X of Y” bottom centre), `buildFaxCover` (no patient details; pages incl. cover; confidentiality notice),
`listFormFields` (text / checkbox / dropdown / radio / other + page via widget /P), `CHECK_RULES` (always / level:x /
type:x), `fillForm` (field map rules; single-line fields get newlines → “, ”; max length respected; per-field try; Helvetica
appearances; optional flatten; returns the original bytes on failure), `mergePdfs`, `buildAppealPdf` (letter → form →
fax cover prepended with the final page count). `src/lib/payerForms.js` + `loadPayerFormBytes` (storage download),
`hasFieldMaps`, `saveFieldMap` (audit `payer_form_fields_map`). `FormFieldMapper.jsx` (rules per field, “Test fill” with
`SAMPLE_VALUES` opens a blob tab). `AppealPdf.jsx` (inside `AppealLetter.jsx`, which now keeps the whole
`loadPayerInfo` data and reloads fresh after a map is saved): parts, form picker (PDF only), deadline status (late / soon
≤ 3 days → “I understand” tick before the save step), file name from kv `packet_naming` (editable), `PdfSaveOptions`
with audit `appeal_pdf_built` {fax_cover, letter, form, prefilled, flatten, deadline}.

Plan as approved (defaults: fax cover on when a fax exists, no PHI on it; flatten filled forms on; deadline warnings at
past due and ≤ 3 days; packet naming convention reused; field maps edited by Payer Directory editors):
- Appeal Builder **📄 Build the PDF** section: ticked parts in order — (1) fax cover sheet (To payer appeals + fax, From
  sender + client, pages, date, “Re: Appeal”, confidentiality notice; no patient details), (2) cover letter (the 📝 Letter
  text filled locally; Letter size, Times, 1" margins, wrapping, Page X of Y), (3) payer form from the Payer Directory
  (appeal / recon / corrected-claim): fillable → pre-filled via the form's field map, optional flatten; not fillable →
  added as-is “fill by hand”. Send-to details with copy buttons beside the button.
- Deadline check before saving (4.4 limits + denial date): past due → warning + good-cause reminder; ≤ 3 days → heads-up;
  no limit → “not checked”.
- **🧩 Map form fields** pop-up (`payers_edit`): every PDF field (name, type, page) → placeholder / fixed text / tick
  rule (e.g. tick when level = recon) / blank; test fill with made-up sample data; saved on the payer form.
- Shared Original/Compress save step; file name from the packet naming convention (editable). Built in the browser; never
  uploaded / saved / logged. Audit `appeal_pdf_built` counts only (pages, form, fax cover, deadline status). 5.5 adds
  “Add to Appeal Packet”.
- DB: `supabase/migrations/20261021g_payer_form_fields.sql` → `payer_forms.field_map jsonb` (no PHI). Until run: forms
  attached as-is.
- Files: new `src/lib/appealPdf.js`, `src/pages/workbench/AppealPdf.jsx`, `FormFieldMapper.jsx`; changed
  `AppealBuilder.jsx`, `src/lib/payerForms.js`, `src/lib/auditLabels.js`.

### Reference: how 5.3 was built (done)

No database change. **Change from the plan (PO decision 2026-10-20):** no `appeal_ai` permission — AI wording is open to
everyone; per-person switch-off would have needed Team page changes (role defaults can't be revoked per user today).
`src/lib/appealAI.js`: `STYLES`, `phiIssues` (date-like incl. month names, 5+ digit numbers, ID-like letter/digit mixes,
phone, email, DOB/MRN/SSN/member ID/claim #/Mr./Mrs. words), `buildAIRequest` (facts = denial type, level, payer, client,
codes, plain reason + NON-identifier key facts of the type + notes if ticked; free-text facts and the template are PHI-
checked → `problems` block sending), fixed `SYSTEM` instructions, `validateAILetter` (identifier tokens of the template
must survive; unknown tokens rejected; new/unused tokens + date/number warnings), `improveWording` (raw fetch, model
`claude-opus-5-5`, `output_config { effort: 'medium', format: json_schema { letter, notes } }`, `fallbacks: 'default'`
+ `anthropic-beta: server-side-fallback-2026-07-01`, refusal / max_tokens / 401 / 429 messages; audit
`appeal_ai_wording` {denial_type, style, ok} only). `AppealAIPanel.jsx` (styles, notes tick, “What AI will see”, PHI block,
confirm tick, try again, ↺ template version). `AppealLetter.jsx`: letter body = `form.ai_body ?? template.body` (AI text
keeps placeholders and is filled locally, so later form edits still flow in); 🔀 Show changes; changing template clears
the AI text. Never sent: the edited/filled letter (`letter_text`).

Plan as approved (defaults: Claude Opus 5.5 at medium effort; refusal fallback on; sending blocked when the PHI check finds
something; confirmation tick every time; available to all roles, switchable per person) — no database change:
- 📝 Letter gets **“✨ Improve wording with AI”**: style (Firm and formal / Neutral / Short and to the point), optional
  “use my Why-we-disagree notes as arguments”; “What AI will see” box = template with placeholders only + non-identifier
  facts (denial type, codes + plain reason, level, payer name, client name, records list, units, notes if ticked). Never
  patient name/DOB/member ID/claim #/auth #/any dates/🔒 fields.
- PHI check on free text (date-like, long numbers, DOB/MRN/SSN words…) blocks sending; tick “I confirm there is no patient
  information…” required.
- Answer validated: every identifier placeholder of the template still present, no new placeholders, no real-looking
  dates/numbers added; missing required placeholder → rejected. Filled locally → editable letter (5.2); Show changes
  (template vs AI side by side); ↺ Use the template version instead; Copy / Print as before.
- API (raw fetch from the browser like the existing `callAI`, which stays untouched): model `claude-opus-5-5`, thinking
  adaptive (can't be off), `output_config: { effort: 'medium', format: json_schema {letter, notes} }`, max_tokens 16000,
  fixed instructions (keep every [TOKEN], never invent facts/dates/numbers, no patient details), no prefill;
  `fallbacks: "default"` + header `anthropic-beta: server-side-fallback-2026-07-01`; handle `stop_reason: "refusal"`.
  No key in Settings → “AI wording isn’t set up — an admin can add the AI key in Settings.” Known: the key is readable
  by app users (existing design) — a server proxy could be a later step; no PHI sent so no BAA needed for this feature.
- New grantable permission `appeal_ai` “Use AI wording for appeals” (all roles by default). Audit `appeal_ai_wording`
  with denial type, style, success only — never text.
- Files: new `src/lib/appealAI.js`, `src/pages/workbench/AppealAIPanel.jsx`; changed `AppealLetter.jsx`,
  `src/lib/appeals.js`, `src/lib/access.js`, `src/lib/auditLabels.js`.

### Reference: how 5.2 was built (done)

`src/lib/appealTemplates.js`: `TEMPLATE_TYPES` (incl. `any`), `TOKEN_GROUPS` (frame tokens `[TODAY]`, `[SENDER_NAME]`,
`[PAYER_APPEALS_ADDRESS]`, `[PAYER_APPEALS_FAX]` + all 5.1 tokens; `id` flag), `SAMPLE_VALUES` (made-up), `fillTemplate`
(“?” optional lines dropped when a token is empty; blank-line runs collapsed; returns parts for highlighting, text,
missing), `pickTemplate` (client +4, type +2, level +1; non-matching client/type/level excluded), `checkTemplate`
(unknown tokens, real-looking dates, 6+ digit numbers), CRUD, `STARTER_TEMPLATES` (8, our wording, shared HEAD/FOOT).
`AppealLetter.jsx`: best/chosen template, values = `placeholderMap` + frame (sender = `user.name`, address/fax = first
appeals contact via `loadPayerInfo`), highlighted preview, Show placeholders, edit (`form.letter_text`, in memory; ↺
Rebuild), 📋 Copy, 🖨 Print (new window). `AppealTemplates.jsx`: list by type, editor (placeholder picker, sample preview,
warnings), copy, review, (re)activate, starter. `AppealBuilder.jsx`: ✉️ Appeal / 📚 Templates tabs (`appeal_templates`).

Plan as approved (defaults: 8 starter letters; “?” optional-line rule; automatic best template; copy + print now, PDF in
5.4; new permission admin/manager):
- Template = plain text with 5.1 tokens + frame tokens `[TODAY]`, `[SENDER_NAME]`, `[PAYER_APPEALS_ADDRESS]`,
  `[PAYER_APPEALS_FAX]`; a line starting with `?` is dropped when any token in it is empty. Each template: denial type,
  appeal level (any / specific), optional client. Placeholders only — editor warns on real-looking dates, long ID
  numbers, unknown tokens.
- Appeal Builder **📝 Letter** section: best template auto-picked (client+type+level → type+level → type → general),
  changeable; preview filled locally, empty tokens highlighted; Show placeholders / Show filled; editable letter kept in
  memory with the form; 📋 Copy letter, 🖨 Print. Nothing saved or logged.
- **📚 Templates** tab (new grantable `appeal_templates` “Manage appeal letter templates”, admin/manager): list by type,
  add / edit / copy / make inactive / reactivate; editor with placeholder picker, live preview with made-up sample
  values, checker; “Add starter templates” (8: one per denial type + corrected-claim cover letter; “Starter – please
  review”).
- DB: `supabase/migrations/20261021f_appeal_templates.sql` → `appeal_templates` (id, name, denial_type, level,
  client_id, body, source starter/manual, reviewed_at/by, active, created/updated). No PHI.
- Files: new `src/lib/appealTemplates.js`, `src/pages/workbench/AppealLetter.jsx`, `AppealTemplates.jsx`; changed
  `AppealBuilder.jsx`, `src/lib/appeals.js`, `src/lib/access.js`, `src/lib/auditLabels.js`. Audit
  `appeal_template_add/edit/review/activate/deactivate`, `appeal_starter_add` (letters never logged).

### Reference: how 5.1 was built (done)

No database change. `src/lib/appeals.js`: `APPEAL_LEVELS` (→ limit type/level for the deadline), `BASE_FIELDS`,
`PATIENT_FIELDS`, `DISAGREE_FIELD`, `DENIAL_TYPES` (auth / timely / necessity / eligibility / duplicate / coding / other,
each with key-fact fields; `id: true` = identifier → placeholder only), `typeForCategory` (Denial library category →
type), `placeholderMap(form, ctx)` → [{ token, label, value, id }], `hasIdentifiers`; module-level in-memory store
(`getAppealDraft` / `saveAppealDraft` / `clearAppealDraft`, keyed by emp_id; never DB / logs / browser storage; cleared on
the `helix:signed-out` event); `startAppeal` sets a prefill and fires `helix:open-tab` → `wb_appeals`. `src/App.jsx`
(additive only): listener for `helix:open-tab` (only `wb_` tabs) and `helix:signed-out` dispatched in `handleLogout`.
UI: `AppealBuilder.jsx` (form + side panel grid, PHI banner, 🗑 Clear form, SOP / payer card opened in place),
`AppealForm.jsx`, `AppealSidePanel.jsx` (deadline for the chosen level via `loadPayerInfo` + `computeDeadline`, where to
send + forms, read-only `DenialLayers` per code, facts summary). Denial Navigator cards: “✉️ Start an appeal”.

Plan as approved (defaults: nothing saved; denial types + key facts below; placeholders for all dates and IDs;
App.jsx tab listener) — no database change:
- **✉️ Appeal Builder** (`wb_appeals`, replaces placeholder; everyone). Denial Navigator code cards get “✉️ Start an
  appeal” → opens Appeal Builder pre-filled with the code + Working-on client/payer.
- Form: (1) client, payer, denial code(s) (typed or pasted ERA line, checked against the library), denial date,
  claim #, DOS from/to, appeal level (1st / 2nd / reconsideration / corrected claim), denial type (auto from the code
  category, changeable) with key facts — Authorization (auth #, approval date, auth from–to, visits/units),
  Timely filing (original submission date, clearinghouse acceptance report # + date, payer receipt date), Medical
  necessity / records (records checklist: plan of care, visit notes, physician order, face-to-face…; order date),
  Eligibility / COB (eligibility check date + source, primary EOB date + amount), Duplicate (original claim #, why
  not), Coding / billing (what was wrong / corrected), Other (free text); (2) 🔒 patient identifiers (name, DOB,
  member ID) with their placeholders; (3) “Why we disagree” free text + no-patient-details warning.
- Side panel: deadline (4.4 with denial date + payer/client limits), where to send (appeals fax/address + copy,
  appeal forms), steps to follow (4.2 layers, collapsed), facts summary with placeholders (`[AUTH_NUMBER] = …`) for
  5.2/5.3. Dates, claim #, auth #, member details are identifiers → always placeholders for AI.
- PHI: nothing saved to the DB, logged or put in browser storage; in-memory only while Helix Hub is open (survives
  tab switches; wiped on refresh / sign-out / 🗑 Clear form); “🔒 Contains patient details — clear when done” banner;
  no audit entry. (Later optional: non-PHI appeal tracker.)
- Files: new `src/lib/appeals.js`, `src/pages/workbench/AppealBuilder.jsx`, `AppealForm.jsx`, `AppealSidePanel.jsx`;
  changed `WorkbenchApp.jsx`, `DenialNavigator.jsx`, `src/App.jsx` (small additive listener so a page can open another
  allowed sidebar tab).

### Reference: how 4.4 was built (done)

No database change. `src/lib/deadlines.js` (`DATE_FIELDS` matching `payer_limits.measured_from` labels, `fromKeyOf`
— unknown/Other → denial date flagged “assumed”, `MEDICARE_PRESETS` (redetermination 120 d + 5 d receipt,
QIC reconsideration 180 d + 5 d receipt, TFL 1 calendar year from DOS), `computeDeadline` (calendar days; years add
calendar years, Feb 29 → Feb 28; weekend → `sendBy` previous Friday), `STATUS_STYLE` ok / soon (≤ 14) / late,
`summaryLine` for claim notes). `DeadlineHelper.jsx` card (sources: payer limits via `loadPayerInfo` — now incl. TFL —
/ Medicare / by hand; asks only the needed dates; 📋 Copy summary). `DenialNavigator.jsx` shows it in 🔎 Look up;
`DenialLayers.jsx` payer box has “⏰ Work out the deadline” (opens + scrolls to `#deadline-helper`). Dates never stored.

Plan as approved (defaults: 🟠 at ≤ 14 days; calendar days; weekend warning without moving the date; Medicare
quick-fill included + labelled; TFL shown for reference) — no database change:
- **⏰ Deadline helper** card in Denial Navigator 🔎 Look up (under “Working on”); 🟦 payer layer gets “⏰ Work out the
  deadline” jump button. Everyone.
- Uses the Working-on payer + client: payer limits AFL (all levels) / RECON / CCTFL / TFL with the client contract
  limit replacing the standard one. Asks only the dates those limits count from (denial/EOB, DOS, discharge, paid).
- Result per limit: due date, “N days from <date>”, days left; 🟢 > 14 · 🟠 ≤ 14 · 🔴 past due (by N days); weekend
  due date → “send by Friday to be safe” (never moved later); source label (payer standard / client contract).
- 📋 Copy summary for claim notes (no patient details).
- No limits recorded → enter days by hand (“entered by hand”) or “Use Medicare standard limits” (check current CMS
  rules): redetermination 120 days from receipt of the initial determination (receipt = notice date + 5 days);
  reconsideration (QIC) 180 days from receipt of the redetermination; timely filing 1 calendar year from DOS
  (“through” date for institutional claims).
- Calendar days; note that some payers count from receipt. Dates typed are never saved, logged or sent; no audit entry.
- Files: new `src/lib/deadlines.js`, `src/pages/workbench/DeadlineHelper.jsx`; changed `DenialNavigator.jsx`,
  `DenialLayers.jsx`, `src/lib/denialSteps.js` (TFL too). 6.2 calculators can reuse `deadlines.js`.

### Reference: how 4.3 was built (done)

No database change. `DenialNavigator.jsx` shows tabs 🔎 Look up / 🛠 Manage steps for `denials_edit` once
`denial_steps` exists. `DenialAdmin.jsx`: Coverage table (per code: common ✓, client/payer counts with names on hover,
re-check count, optional client/payer column with “missing”; filters; tick codes; 100 per page), Review queue (never
verified first, then oldest), Inactive (reactivate refused while another active entry exists for that layer).
`DenialAdminTools.jsx`: `CodeStepsModal` (all entries of a code + add common/client/payer), `CopyStepsModal`
(common or client → client; `planCopy` / `applyCopy` in `denialSteps.js`; skips clients that already have steps; copies
unverified, client copies drop the source's linked SOP), `StepsImportModal`. `src/lib/denialStepsImport.js`: template
(Code Type, Code, Layer, Client, Payer, Steps, Linked SOP title, Notes + “How to” sheet), read (exact template headers,
any case), compare (payer by exact name or alias via `matchPayer` score 0; errors per row), apply (skip / replace;
replace only overwrites non-blank optional cells), export (re-importable layout + Verified column).

Plan as approved (defaults: import skips existing unless “replace”; copies start unverified; 180-day review; editors only)
— no database change:
- Denial Navigator tabs **🔎 Look up** · **🛠 Manage steps** (`denials_edit` only).
- **Coverage**: row per code — Common ✓/—, Client steps (count, names on hover), Payer steps (count), Needs re-check;
  filters type/category/search + “Missing common steps”; pick a client / payer → ✓/missing column; click a row → all
  entries of the code (common, every client, every payer) to add / edit / verify / make inactive (4.2 pop-up).
- **Copy**: tick codes → “Copy common steps to client…” (preview copied / skipped-existing); also client → client.
  Copies start unverified (review queue).
- **Excel**: template (Code type, Code, Layer, Client, Payer, Steps, Linked SOP title, Notes); import preview new /
  update / skipped / errors; skip existing (default) or replace; blank cells never erase; nothing deleted. Export all.
- **Review queue**: never verified or > 180 days, oldest first, inline ✓ Verified + Open; filter layer/client/payer.
- **Inactive** entries with ↺ Reactivate.
- Files: new `src/pages/workbench/DenialAdmin.jsx`, `DenialAdminTools.jsx`, `src/lib/denialStepsImport.js`; changed
  `DenialNavigator.jsx`, `src/lib/denialSteps.js`, `src/lib/auditLabels.js`. Audit `denial_steps_copy`,
  `denial_steps_import` (counts).

### Reference: how 4.2 was built (done)

Code: `src/lib/denialSteps.js` (`loadDenialSteps`, `loadStepContext` clients/payers/sops, `layerEntry` = the one
active entry per code + scope + client/payer, `saveSteps` refuses a second active entry, verify / make inactive,
`stepsNeedRecheck` uses `SOP_RECHECK_DAYS`; `loadPayerInfo(payerId, clientId)` session-cached: appeals contacts,
AFL/RECON/CCTFL limits with the client's override replacing the base of the same type+level+plan, current
appeal/recon/corrected-claim forms with files, pinned Claims/Appeals notes). UI: `DenialLayers.jsx` (`LayerBox`,
`PayerDirectoryInfo`), `DenialStepsModal.jsx`; `DenialNavigator.jsx` adds “Working on” client select + PayerSearch
(remembered in localStorage `helix_denial_client` / `helix_denial_payer`), “What to do ▾” per code card, opens linked
SOPs (`SopPage`, like Training) and the payer card (`PayerCard`) in place. Form downloads use 60-second signed links.

Plan as approved (defaults: pickers remembered per computer; client steps only when a client is picked; layers expand on
demand; 180-day re-check; editing = existing `denials_edit`):
- Denial Navigator gets **Client** and **Payer** pickers (payer = Payer Directory type-ahead with aliases). Each code card
  gets **“What to do ▾”** with three layers: 🟨 **Client steps** (highlighted, top; only with a client picked; client's
  steps + “📄 Open client SOP” opened in place like Training; “No special steps for X…” when none) → 🟦 **Payer rule**
  (payer's steps for the code + auto from Payer Directory: appeals/recon fax & address with copy, appeal / corrected-claim
  limits incl. client overrides, appeal/recon forms, pinned Claims/Appeals notes; “Open payer card ›”) → ⬜ **Common
  3Gen steps** (always). Pasted ERA lines show “What to do” per code.
- Steps entry per code + layer: numbered steps (SOP formatting marks), optional linked SOP, notes, verified + 180-day
  re-check. Editors add/edit inline; make inactive; nothing deleted. 4.3 = admin overview/gaps/copy/import/review.
- DB: `supabase/migrations/20261021e_denial_steps.sql` → `denial_steps` (id, code_id, scope common/client/payer,
  client_id, payer_id, steps, sop_id, notes, verified_at/by, active, created/updated); one active per code+scope+target.
- Files: new `src/lib/denialSteps.js`, `src/pages/workbench/DenialLayers.jsx`, `DenialStepsModal.jsx`; changed
  `DenialNavigator.jsx`, `src/lib/auditLabels.js`. Audit `denial_steps_add/edit/verify/deactivate` (ids only).

### Reference: how 4.1 was built (done)

Code: `src/lib/denials.js` (`CODE_TYPES`, `CATEGORIES`, `GROUP_CODES` meanings, `parseCodeLine` — tokens split on
space/comma/;/|/slash, money amounts skipped, "CO 16"/"CO-16"/"co16" → group + CARC, M/MA/N+digits → RARC, 4–6 digits →
other (FISS); `findCode` falls back between carc/other for numeric codes; `searchCodes`; import: `readImportFile` (first
sheet; headers matched loosely: code / desc|text|meaning / type / stop|deactiv|retire; “Stop: mm/dd/yyyy” inside the
description also read) → `compareImport` → `applyImport` (500-row batches, updates official_text + stopped_on only);
`STARTER_CODES` (49: 5 group, 31 CARC, 13 RARC — our own wording, source 'starter', unverified)). UI:
`DenialNavigator.jsx` (search box decides: only codes → “codes found” cards with group meaning; else text search with
type/category/retired/unverified/inactive filters, 60 per page), `DenialEditors.jsx` (code / import / starter pop-ups).
Route `wb_denials` in `WorkbenchApp.jsx` (placeholder entry already existed in `modules.js`).

Plan as approved (defaults: ~40 starter codes; import never touches plain-English reasons; category list below):
- New page **🧩 Denial Navigator** (`wb_denials`, replaces the placeholder; everyone). 4.1 = Denial library.
- Entry: type CARC / RARC / Group (CO/PR/OA/PI/CR) / Other (e.g. FISS reason codes); official description (from
  import); our plain-English reason; category (Eligibility · Authorization · Coding · Timely filing · Duplicate ·
  Documentation / records · Coordination of benefits · Medicare HH & Hospice · Patient responsibility · Other);
  notes; “No longer used after” date; verified date + by.
- Search: code (`16`, `CO-16`, `co16`, `N290`) or words; paste an ERA/EOB line (`CO-16 N290 MA130`) → every code found
  shown together, group code explained. Results: plain reason first, official text below, copy button, Retired badge.
- Import Excel/CSV (X12 lists downloaded by the PO from x12.org): preview new/changed/unchanged; fills official text +
  retired dates only, never plain reasons. Full X12 lists are NOT bundled (reuse terms; no retyping from memory).
- “Add starter codes”: ~40 common HH/hospice/AR codes with our own plain reasons + categories, marked
  “Starter – please verify” until verified. No SQL seed. Add/edit single codes; make inactive; nothing deleted.
- Permission `denials_edit` “Edit Denial library” (admin/manager, grantable; reused by 4.3). Viewing open to all.
- DB: `supabase/migrations/20261021d_denial_codes.sql` → `denial_codes` (id, code_type, code, official_text,
  plain_reason, category, notes, stopped_on, source starter/import/manual, verified_at/by, active, created/updated),
  unique type+code. Pasted ERA lines are searched in the browser only — never saved or logged.
- Files: new `src/lib/denials.js`, `src/pages/workbench/DenialNavigator.jsx`, `DenialEditors.jsx`; changed
  `WorkbenchApp.jsx`, `src/lib/access.js`, `src/lib/auditLabels.js`. Audit `denial_code_add/edit/verify/deactivate`,
  `denial_import` (counts), `denial_starter_add`.

### Reference: how 3.7 was built (done)

No database change. `STARTER_SOFTWARE` + `missingStarterSoftware(lib)` in `src/lib/sops.js`; `addStarterSoftware` in
`sopActions.js` (creates a missing standard category first, appends software at the end of each category, one audit
`sop_software_add` {count, standard}); `StarterSoftwareModal` in `SopEditors.jsx`; button “Add standard software (N)” in
`SopLibrary.jsx` while any standard entry is missing. Present = same name in any category, any letter case.

Plan as approved — no database change (no new migration):
- Editors get **“Add standard software”** in the SOP Library (like “Add standard categories”), shown while any standard
  entry is missing; pop-up lists the missing ones grouped by category, all ticked; names already present (any case)
  are skipped; a missing standard category is re-created with its standard name. No tasks/SOPs created.
- List: EMR — WellSky (Kinnser), Axxess, HCHB; Clearinghouse — Waystar, Inovalon (ABILITY); Payments/ERA — ECHO Health,
  PaySpan; Payer portals — Availity, NaviNet, Palmetto GBA eServices, myCGS, NGSConnex; Medicare DDE — FISS DDE –
  Palmetto GBA / CGS / NGS (incl. home health & hospice). Login links left blank on purpose (often client-specific).
- Files: `src/lib/sops.js` (`STARTER_SOFTWARE`), `sopActions.js` (`addStarterSoftware`), `SopEditors.jsx` (pick-list
  pop-up), `SopLibrary.jsx` (button). Audit one `sop_software_add` with the count.

### Reference: how 3.6 was built (done)

Code: `src/lib/sopQuiz.js` (load quiz / my attempts / per-person summary, `checkQuiz`, `saveSopQuiz`, `shuffledOrder`,
`scoreQuiz`, `saveAttempt` with a copy of the questions; `loadQuizPasses` returns null when 3.6 isn't set up),
`SopQuiz.jsx` (card on the SOP page: take / result / best score; editors get “Add/Edit quiz”), `SopQuizEditor.jsx`
(pop-up). Answers are stored as ORIGINAL option indexes; the display order is shuffled per attempt. `SopTracking.jsx`
adds a Quiz column + Excel columns. Training: `loadTraining` adds `quizAttempts` + `quizReady`; `assignmentStatus` SOP rows
carry `acked` and `quiz`; an item with `needs_quiz` is done = acknowledged AND passed (done date = the later of the two).
`needs_quiz` is only written when `quizReady` (column comes with the 3.6 migration). `sopVersions.js` didn't need changes.

Plan as approved (defaults: 80% pass mark; unlimited retakes; right answers shown only after passing; answer order
shuffled; “Must pass the quiz” off by default on path items):
- **Quiz editor** (`sops_edit`, “📝 Edit quiz” on the SOP page): one quiz per SOP; multiple choice (2–5 answers, one
  correct) or True/False; optional “Why” explanation; pass mark per quiz; 3–5 questions recommended (warn outside,
  allow 1–10); ▲▼ reorder; switch quiz off; nothing deleted; no-PHI reminder.
- **Take the quiz** (everyone, published SOPs): card at the bottom of the SOP; shuffled answers; Submit → score +
  passed/failed; failed shows which were wrong (not the right answers); passed shows answers + “Why”; unlimited retakes;
  “Your best” shown; a later quiz change doesn't undo an earlier pass.
- **Scores:** SOP tracking panel + Excel get a Quiz column (best, attempts, passed date). Training: SOP items get a
  “Must pass the quiz” tick (`learning_path_items.needs_quiz`) — done = acknowledged AND passed; My training / Team
  progress / Excel show quiz status. (Chosen instead of a new item kind so no CHECK constraint changes.)
- Scoring runs in the browser; quiz readable via the public key like all app data — fine for internal checks, not
  formal certification.
- DB: `supabase/migrations/20261021c_sop_quizzes.sql` → `sop_quizzes` (id, sop_id, pass_pct 80, questions jsonb,
  active, created/updated), `sop_quiz_attempts` (id, quiz_id, sop_id, emp_id, correct, total, score_pct, passed,
  answers jsonb, questions snapshot, taken_at), `learning_path_items.needs_quiz`. Select/insert/update only. No PHI.
- Files: new `src/lib/sopQuiz.js`, `src/pages/workbench/SopQuiz.jsx`, `SopQuizEditor.jsx`; changed `SopPage.jsx`,
  `SopTracking.jsx`, `src/lib/sopVersions.js`, `src/lib/training.js`, `TrainingPathEditor.jsx`, `TrainingProgress.jsx`,
  `src/lib/auditLabels.js`. Audit `sop_quiz_edit`, `sop_quiz_attempt` (score + pass/fail, ids only).

### Reference: how 3.5 was built (done)

Code: `src/lib/training.js` (`loadTraining` loads paths/items/assignments/active progress + SOP acks + sops + users;
`dueDateFor` = start moved off weekends + working days; `assignmentStatus` per item done/due/overdue, SOP items done via
`sop_reads.acknowledged_at` for that SOP (any version); ticks/untick (inactive), `stampCompletion`, path/item save, copy,
reorder, `assignPath` keeps progress and only changes the start date). UI: `Training.jsx` (tabs; opens SOPs with
`SopPage forceAck backLabel` so any SOP in a path can be acknowledged; `loadAndStamp` stamps finished paths on load),
`TrainingProgress.jsx` (`ProgressBar`, `AssignmentDays` self/trainer modes, team table + Excel), `TrainingPathEditor.jsx`
(paths list, `PathEditor` days/items, `ItemModal`, `PathModal`), `TrainingAssign.jsx`. Sidebar: `modules.js` `wb_training`.
Additions beyond the plan text: `learning_paths.days` (empty days while building), `learning_progress.active` (undo a tick).
Known limit: an SOP with no published version can't be acknowledged, so its path item stays open until it is published.

Plan as approved (defaults: due dates skip weekends; one team per path; people tick tasks/links themselves unless
“Trainer must confirm”; no auto-assign on user creation — would need Team page changes):
- New Workbench sidebar page **🎓 Training** (`wb_training`, all roles): **My training** · **Team progress** · **Manage paths**.
- Path = name, description, team; **Day 1…N** with ▲▼ items: 📄 SOP (done = person acknowledged any version, via the 3.4
  button), ✅ Task (self-tick), 🔗 Link (self-tick); any item can be “Trainer must confirm”. 3.6 adds 📝 Quiz items.
  Copy / make inactive / reactivate paths; nothing deleted.
- **Assign**: pick people (“Select whole team”), start date; Day N due = start + (N−1) working days. Re-assign keeps history.
- **My training**: progress bar, “Day 3 of 5”, items by day with due dates, overdue in red, SOP items open the SOP
  (acknowledge button shown for SOPs in my path even if the version didn't require it; “← Back to my training”), 🎉 complete.
- **Team progress**: per person × path: % done, current day, overdue count, started/finished; drill into items; trainers
  tick “Trainer must confirm” items; filters path/team/overdue only; Download Excel.
- Permissions: `training_manage` “Manage learning paths” (admin/manager), `training_track` “See training progress +
  confirm items” (admin/manager/supervisor). Both grantable.
- DB: `supabase/migrations/20261021b_learning_paths.sql` → `learning_paths`, `learning_path_items`
  (day_no, sort_order, kind sop/task/link, sop_id, title, url, needs_trainer, active), `learning_assignments`
  (path_id, emp_id, start_date, assigned_by/at, completed_at, active), `learning_progress` (assignment_id, item_id,
  done_at, done_by). SOP completion read from `sop_reads`. Select/insert/update only. No PHI.
- Files: new `src/lib/training.js`, `src/pages/workbench/Training.jsx`, `TrainingPathEditor.jsx`, `TrainingAssign.jsx`,
  `TrainingProgress.jsx`; changed `modules.js`, `WorkbenchApp.jsx`, `src/lib/access.js`, `src/lib/auditLabels.js`,
  `SopPage.jsx`. Audit `training_path_add/edit`, `training_assign`, `training_item_done`, `training_trainer_confirm`,
  `training_path_complete` (ids only).

### Reference: how 3.4 was built (done)

Code: `src/lib/sopVersions.js` (`SNAPSHOT_KEYS`, `loadSopVersionMeta` — versions without snapshots via PostgREST
`snapshot->>title` aliases + my reads, `versionStates` current/upcoming/archived from `effective_date` vs local `today()`,
`hasUnpublishedChanges` compares working copy to the newest version, `publishSopVersion`, `recordSopRead`, `acknowledgeSop`,
`pendingAcknowledgements`, `loadSopTracking`), `SopVersions.jsx` (Publish pop-up, Version history, Client copy pop-up),
`SopTracking.jsx` (lazy-loaded panel + Excel via dynamic `import('xlsx')`). `SopPage.jsx`: readers see the current version
(`sopAsVersion` = row identity + snapshot); editors switch Published / Working copy / any version (ARCHIVED/UPCOMING banner);
publish button disabled when nothing changed. `SopLibrary.jsx` builds a reader view (`viewLib`) where titles/summaries come
from the current version; SOPs with only upcoming versions are hidden from readers. Client SOPs sort first (`bySort`).
Once 3.4 is set up the manual Draft/Published field is hidden in the SOP pop-up (`activeFields`): status becomes
“published” on first publish. `sop_reads` counts opens of the current version (also editors' opens).

Plan as approved (defaults: “must acknowledge” ticked; only editors open archived versions; acknowledgement applies to
the ticked “Who uses it” teams, everyone if none; tracking for admins/managers/supervisors; all users see all clients' SOPs):
- **Versions:** editors edit a working copy (`sops` row); readers see the published version. “📤 Publish new version”:
  required change note, effective date (today/future), “Everyone must acknowledge”. Frozen snapshot v1, v2… (text, steps,
  media links). Current = latest with effective_date ≤ today; older = Archived; future = upcoming (“v3 takes effect on …”).
  Version history (date, by, note); editors can open old versions under an “ARCHIVED – not current” banner.
  “Unpublished changes” badge. SOPs published before 3.4 with no version: readers see the row as before until v1.
- **Client SOPs:** `sops.client_id` (null = common) set in the Add/Edit SOP pop-up; client badge, listed first + highlighted
  under the task; client filter (client's + common); “📋 Make a client copy” → new draft for one client (`copied_from`).
- **Acknowledge + reads:** must-acknowledge users = team in `audience_teams` (everyone if none); button “I have read and
  understood this SOP (vN)”; new version needing ack asks again. Library banner “You have N SOPs to acknowledge”.
  Reads recorded automatically (first/last opened, count) per person per version. Tracking panel “18 of 25 acknowledged”,
  who hasn't (by team), dates, Download Excel. New grantable permission `sops_tracking` (admin/manager/supervisor).
- DB: `supabase/migrations/20261021_sop_versions.sql` → `sops.client_id`, `sops.copied_from`; `sop_versions` (id, sop_id,
  version_no, snapshot jsonb, change_note, effective_date, requires_ack, published_by, published_at); `sop_reads` (id,
  sop_id, version_id, emp_id, first_viewed_at, last_viewed_at, view_count, acknowledged_at). Select/insert/update only.
- Files: new `src/lib/sopVersions.js`, `src/pages/workbench/SopVersions.jsx`, `SopTracking.jsx`; changed `SopPage.jsx`,
  `SopLibrary.jsx`, `src/lib/sops.js`, `SopEditors.jsx`, `sopActions.js`, `src/lib/access.js`, `src/lib/auditLabels.js`.
  Audit `sop_publish_version`, `sop_acknowledge`, `sop_client_copy` (ids only); views go to `sop_reads`, not the Audit Log.

### Reference: how 3.3 was built (done)

Code: `src/lib/sopMedia.js` (checks, `renderScreenshot` crop/black-out/resize/WEBP→JPEG fallback, `uploadSopMedia`
→ bucket + `sop_media` row + audit, cached 1 h signed links), `src/lib/sopText.js` (parse/format/HTML for print),
`src/pages/workbench/SopEditorPage.jsx` (full-page editor; paste/drag-drop per step; uploads happen immediately, links saved
with the SOP), `ScreenshotTool.jsx` (crop + black-out canvas, `VideoConfirm`), `SopMedia.jsx` (`SopImage` lightbox,
`SopVideo`), `SopText.jsx` (display), `SopContent.jsx` (sections; shared by page + Preview). `SopPage.jsx` opens the editor
in place and prints screenshots. `SopContentEditor.jsx` (3.2 pop-up) is unused, kept. Old `steps[].image` is read as `images[0]`.
“Media set up?” is detected by the `walkthrough_video` key on the SOP row. Text formatting is plain marks rendered as React
elements — never `dangerouslySetInnerHTML`. Lint note: `react-refresh` forbids mixing component and non-component exports
in one file, hence `sopText.js` (logic) vs `SopText.jsx` (component).

Plan as approved (defaults: 3 screenshots per step; videos ≤ 25 MB / 3 min; black-out tool; upload tick box every time):
- **Full-page editor** (replaces the 3.2 pop-up) in the same screen, Edit / Preview tabs, Save / Cancel, unsaved-changes warning.
  `SopContentEditor.jsx` stays in the repo unused.
- **Formatting, no new library:** toolbar Bold / • bullets / 1. numbered / ⚠ Important line; links auto-clickable.
  Stored as plain text with simple marks (`**bold**`, `- item`, `1. item`, `! important`), rendered as React elements (no HTML).
- **Screenshots per step:** up to 3; Ctrl+V paste, drag-drop or pick (PNG/JPG/WEBP). **Black-out + crop tool** in the
  browser before upload; re-encoding strips EXIF; resized to ≤ 1600 px wide, ~≤ 1 MB. Click to enlarge on the SOP page.
- **Videos:** one short video per step + optional SOP “Watch the walkthrough” video; MP4/WEBM ≤ 25 MB, ≤ 3 min; no compression.
- **PHI:** red banner in the editor; every upload needs the tick “I checked: no patient names, DOB, member IDs, claim
  numbers or addresses are visible.” Private bucket, short-lived signed links (same caveat as payer forms: no PHI allowed).
- **Nothing deleted:** removing media only unlinks it; file + `sop_media` row kept (for 3.4 versions).
- DB: `supabase/migrations/20261020b_sop_media.sql` → private bucket `sop-media` (images + mp4/webm, 25 MB, read + insert
  only), table `sop_media` (id, sop_id, kind, path, size, width, height, duration, uploaded_by, uploaded_at, active),
  column `sops.walkthrough_video jsonb`. Step media in `steps[]`: `images: [...]`, `video`.
- Files: new `src/lib/sopMedia.js`, `src/lib/sopText.js`, `src/pages/workbench/SopEditorPage.jsx`, `ScreenshotTool.jsx`,
  `SopMedia.jsx`; changed `SopPage.jsx`, `SopLibrary.jsx`, `src/lib/sops.js`, `src/lib/auditLabels.js`.
  Audit `sop_media_upload` (kind + size only, never file names), `sop_content_edit`. Editing/upload = `sops_edit` only.

### Reference: how 3.2 was built (done)

Code: `src/lib/sops.js` (`SOP_SECTIONS`, `SOP_RECHECK_DAYS` = 180, `hasSopTemplate`, `sopSteps`, `sopNeedsRecheck`,
`sopSectionFilled`), `src/pages/workbench/SopPage.jsx` (page view, print in a new window, “Mark as verified today”),
`src/pages/workbench/SopContentEditor.jsx` (content pop-up). `SopLibrary.jsx` opens an SOP via `openSopId`.
“Template set up?” is detected by the `steps` key on the SOP row. Sync-structure copies drop `not null`, so code treats
null steps/teams as empty. Audit labels for all SOP actions added to `auditLabels.js`. Never-verified SOPs show “Needs re-check”.

Plan as approved (defaults: re-check after 180 days; “Who uses it” = team chips + free text):
- Clicking an SOP in the library opens a full **SOP page** (same screen, “← Back to library”) with fixed sections:
  Purpose · Who uses it (team chips AR/Auth/Billing-Posting/Coding/Credentialing + notes) · Before you start ·
  numbered **Steps** (instruction + optional tip + screenshot slot showing “Screenshot coming soon” until 3.3) ·
  What you should see · If it goes wrong · footer Owner / Last verified (date + by) / Status / breadcrumb
  Category › Software › Task with copy button for the software login link.
- Empty sections hidden for regular users, shown as “Not filled in yet” to editors. “Needs re-check” badge after 180 days.
  Print button (clean printout).
- Editors (`sops_edit`): “Edit content” pop-up (plain text; steps add/remove/▲▼) and “Mark as verified today”.
- 3.3 adds uploads (screenshots/videos), PHI banner, richer formatting.
- DB: `supabase/migrations/20261020_sop_template.sql` adds to `rcm.sops`: `purpose`, `audience_teams text[]`,
  `audience_notes`, `prerequisites`, `steps jsonb` ([{text, tip, image}]), `expected_result`, `troubleshooting`,
  `last_verified_at`, `last_verified_by`. Until run, the SOP page says “Template not set up yet”; library unaffected.
- Files: new `src/pages/workbench/SopPage.jsx`, `src/pages/workbench/SopContentEditor.jsx`; changed `src/lib/sops.js`,
  `src/pages/workbench/SopLibrary.jsx`. Audit `sop_content_edit`, `sop_verify` (type + id only). No PHI stored.

### Reference: how 3.1 was built (done)

Code: `src/lib/sops.js` (levels config, `loadSopLibrary`, `buildSopTree` search/filter, counts),
`src/pages/workbench/SopLibrary.jsx` (page), `SopEditors.jsx` (one add/edit pop-up for all four levels, incl. moving
an item to another parent), `sopActions.js` (make inactive/reactivate, ▲▼ reorder, “Add standard categories”).
Added companies' tables start empty after Sync structure → editors get an **Add standard categories** button.
Software portal URLs get `https://` added if missing. Duplicate active names under the same parent are refused.

Plan as approved (defaults: regular users see Published only; categories editable by editors):
- New Workbench page **📚 SOP Library** (`wb_sops`, replaces the placeholder): Category → Software → Task → SOPs; search
  across software/task/SOP titles; category filter.
- Categories seeded: EMR, Clearinghouse, Payments/ERA, Payer portals, Medicare DDE, Other (editable, reorderable).
- SOP in 3.1 = shell only: title, summary, owner, status Draft/Published, updated date. Template = 3.2, editor/uploads = 3.3,
  client-specific/versions/acknowledge = 3.4 (new columns then), seeded software = 3.7.
- Software: optional portal/login URL with copy button. Add/edit/reorder/deactivate in pop-ups; nothing deleted.
- New grantable permission `sops_edit` “Edit SOP Library” (admins + managers). Viewing open to all; non-editors see Published only.
- Audit: `sop_category_add/edit`, `sop_software_add/edit`, `sop_task_add/edit`, `sop_add/edit` (type + id, no free text).
- DB: `supabase/migrations/20261019d_sop_library.sql` → `sop_categories`, `sop_software`, `sop_tasks`, `sops`
  (ids not FKs, select/insert/update grants only). Page says “not set up yet” until it is run.
- Files: new `src/lib/sops.js`, `src/pages/workbench/SopLibrary.jsx`, `src/pages/workbench/SopEditors.jsx`;
  changed `WorkbenchApp.jsx`, `src/lib/access.js`.

### Reference: how 2.5 was built (done) — defaults chosen: cover sheet ON; `{PatientLast}` available, not in the default; “Page X of Y” bottom right + optional prefix

Code: `src/lib/packet.js` (sections, file→PDF, cover sheet, assembly, rotation-aware page stamps, naming) and
`src/pages/workbench/AppealPacket.jsx` (UI + naming-convention pop-up). New grantable permission `packet_settings`
(admins + managers) controls the company convention in kv `packet_naming` (default `{ClaimNo}_{Payer}_{Type}_{Date}`).
Patient name / member ID / claim # typed in are used only to build the PDF in the browser — never saved or logged.
Payer forms that are Word/Excel can't be added directly (must be saved as PDF first) — shown on the button.

Plan as approved:
- New File Tools tool **Appeal Packet**. Sections in default order: Cover letter → Appeal/Recon form → EOB / denial letter →
  Auth approval → Medical records → Other. Each takes PDFs and images (any File Tools format, incl. TIFF); several files
  per section; reorder sections and files; empty sections skipped.
- **Payer form from the Payer Directory:** pick payer → its forms (1.4) → added to the Form section (private signed link).
- **Optional packet cover sheet / index** (generated locally): payer, claim #, DOS, sent by/date, and a contents list with
  page ranges per section; appeals fax/address auto-filled from the payer's Appeals contact.
- **Page numbers** stamped on every page (“Page X of Y”, bottom right; optional prefix e.g. claim #), on/off.
- **File naming convention** with tokens ({Payer} {Client} {ClaimNo} {Type} {Date} …); company default editable by
  people with a new grantable permission `packet_settings` (admins + managers by default); stored in kv `packet_naming`.
- Then the shared **Original / Compress (High/Medium/Low, size limit)** save step.
- Everything in the browser; audit `build_appeal_packet` with counts only (no claim #/names). No DB changes.

### Reference: how 2.4b was built (done)

- `src/lib/ocr.js` starts one Tesseract worker using **bundled** files (Vite `?url`): `tesseract.js/dist/worker.min.js`,
  `tesseract.js-core/tesseract-core-simd-lstm.wasm.js`, `@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`;
  `workerBlobURL: false`, absolute URLs. **`vite.config.js`** keeps `*.traineddata.gz` un-hashed under `tessdata/`
  (Tesseract fetches `<langPath>/eng.traineddata.gz`); if that ever breaks the app shows “OCR couldn’t start…” (`ocr-setup`).
- `src/lib/pdfExtract.js`: `pageToRows` takes positioned pieces from the text layer or OCR words; OCR runs only on pages
  with an image and no text (300 dpi, max 5000 px); words under 60% confidence mark cells (`low`) → yellow in the preview.
  Cancel via `control { cancelled, onCancel }` terminates the worker.
- Lock file: 14 packages added by script from registry data (tesseract.js 7.0.0 [postinstall], tesseract.js-core 7.0.0,
  @tesseract.js-data/eng 1.0.0, bmp-js, idb-keyval, is-url, node-fetch 2.7.0 + whatwg-url/tr46/webidl-conversions,
  opencollective-postinstall, regenerator-runtime, wasm-feature-detect, zlibjs). Checked: every dependency present.

Plan as approved:
- Turn on the “In this browser with OCR (scanned PDFs)” method in PDF → Excel. Pages with real text still use the text
  layer (fast, exact); only scanned pages are OCR'd: pdf.js renders at ~300 dpi → Tesseract words + boxes → the same
  row/column logic as method A (`pageToRows` refactored to take positioned words).
- Library: `tesseract.js` (Apache-2.0; npm latest 7.0.0) + `tesseract.js-core` (wasm engine) + `@tesseract.js-data/eng`
  (MIT, English data) — all from npm, bundled with the app via Vite `?url` imports, **no CDN at runtime**; first use
  downloads ~6–10 MB once (browser caches it). Lock entries from the registry (tesseract.js has ~9 small deps incl. node-fetch).
- Preview highlights low-confidence cells (yellow) with a count (“N words were hard to read — please check”);
  progress “Reading page 3 of 12 (OCR)…”, **Cancel** button; one OCR worker reused, closed when done.
- English only; printed text only (no handwriting); speed ~3–10 s per page.
- Audit `pdf_to_excel` gains `ocr_pages`. No DB changes. Possible later: “make scanned PDF searchable”.

### Reference: how 2.4 was built (done) — PO: “Go with A, with an option to select B, C, D and more; whatever is selected, proceed with that.”

Code: `src/lib/pdfExtract.js` (methods, browser extraction, service connector, tidy + .xlsx), `src/lib/pdfjs.js` (shared loader,
also used by `pdfCompress.js`), UI `src/pages/workbench/PdfToExcel.jsx`. Service contract + HIPAA notes: `docs/PDF_EXTRACTION_SERVER.md`.
Amounts become numbers only when safe (no leading zeros, ≤12 digits without decimals — claim numbers stay text).
The File Tools privacy banner now mentions the one exception (server methods).

What was built:
- Tool **PDF → Excel** in File Tools with a **method selector**. Same preview + .xlsx download whatever the method.
- **A – In this browser (digital PDFs)**: ready. `src/lib/pdfExtract.js` (pdf.js text positions → lines → column gutters → grid).
- **B Vercel function / C Supabase Edge Function / D Own server**: shown as “Needs setup” until an **admin** enters the
  URL (B, D) or function name (C) + optional access key, and ticks “BAA signed”. Stored in kv `pdf_extract_engines`
  (per company). Then the PDF is POSTed there; expected JSON contract in `docs/PDF_EXTRACTION_SERVER.md`.
- **More:** “In this browser with OCR (scanned PDFs)” listed as coming in 2.4b (disabled).
- Options: pages (all / ranges), one sheet per page or all in one, skip repeated header rows, numbers as numbers.
- Audit: `pdf_to_excel` (pages, rows, method) and `configure_extract_engine` (method, enabled, BAA ticked). No DB changes, no new library.

Options shown (HIPAA: any server that touches patient files needs a signed BAA with that host):
- **A. In the browser (recommended first):** pdf.js reads text positions → rows/columns → preview → .xlsx via existing `xlsx`.
  No server, no BAA, nothing leaves the PC. Works for *digital* PDFs (EOBs/remits/aging/payer reports saved as PDF);
  not for scanned images. Deviates from the roadmap wording “on our own server” — needs PO approval.
- **B. Vercel serverless function** (same repo, `/api`; could use Python pdfplumber/camelot). BAA only on Vercel Enterprise.
- **C. Supabase Edge Function** (Deno/JS only, no Python). BAA needs Supabase Team plan + HIPAA add-on; confirm coverage.
- **D. Own server/container under a BAA** (AWS/Azure/GCP; Python + OCR e.g. ocrmypdf/tesseract). Strongest, but cost + upkeep.
- Scanned PDFs later: in-browser OCR (tesseract.js, Apache-2.0, ~10 MB language data, slow) as 2.4b, or OCR on D.
- Output is .xlsx, so the PDF Original/Compress save step doesn't apply here.
Any new File Tools output must use the shared save step `src/pages/workbench/PdfSaveOptions.jsx` (product owner requirement).

### Reference: how 2.3 was built (done) — PO confirmed: no HEIC; Excel = values + layout (no colours/fonts)

Code: `src/lib/imageToPdf.js`, `src/lib/excelToPdf.js`, UI in `src/pages/workbench/ConvertTools.jsx` (tools added to `FileTools.jsx`).
JPG with EXIF rotation and fax TIFFs with uneven X/Y dpi are drawn upright / unsquashed. Excel wide sheets: “Fit all columns”
shrinks font (min 5 pt); otherwise columns continue on extra pages. Cells too long are cut with “…” and counted in a warning.
Dependency `utif` 3.1.0 (MIT; uses the existing pako 1.0.11).

Plan as approved:
- **Images → PDF** (new File Tools tool): JPG, PNG, WEBP, BMP, GIF (first frame) and **TIFF incl. multi-page fax TIFFs**
  (via the small `utif` library, MIT; needs pako, already installed). One image per page; drag to reorder; rotate 90°;
  page size Fit-to-image / Letter / A4 (auto portrait/landscape), margin None/Small. HEIC (iPhone) not supported —
  message asks to export as JPG (decoder is ~2.7 MB + LGPL). Then the shared save step.
- **Excel / CSV → PDF** (new tool): uses the existing `xlsx` library to read .xlsx/.xls/.csv; pick sheet(s); draws a
  table with pdf-lib — gridlines, header row repeated on each page, column widths from the sheet, auto font size,
  portrait/landscape, “fit all columns on one page width”. Shows cell values as displayed (dates/numbers formatted);
  colours/fonts/charts/images are NOT copied (SheetJS free edition can't read styles). Characters outside the standard
  PDF font (e.g. non-Latin scripts) shown as “?” with a warning. Then the shared save step.
- Files: `src/lib/imageToPdf.js`, `src/lib/excelToPdf.js`; `FileTools.jsx` gets two tools (replaces “Convert to PDF (soon)”);
  `package.json`/lock: `utif`. Audit `images_to_pdf` / `excel_to_pdf` with counts only. Open to all roles. No DB changes.

### Reference: how 2.2 was built (done)

- **Product owner requirement (2026-10-19):** every File Tools result offers **“Keep original size & quality”** or
  **“Compress”** with **quality** levels: **High** = original quality (lossless repack, never larger; true “enhancement”
  isn't possible and filters would alter medical documents — explained), **Medium** ≈150 dpi JPEG 0.75 (portals),
  **Low** ≈110 dpi JPEG 0.6 (smallest readable; floor ~100 dpi). Optional **“Must be under __ MB”** steps down
  High → Medium → Low and says so if it can't fit. Size shown before download; if not smaller, the original is kept with a note.
- Code: `PdfSaveOptions.jsx` (UI, used by Merge and Split) + `src/lib/pdfCompress.js` (engine). Only scanned pages
  (draws an image + under 200 characters of real text) are re-rendered with pdf.js; text pages are copied untouched.
- **Split PDF** (`FileTools.jsx`): by ranges (each comma = a file), every N pages, one file per page; max 200 parts; “Download all”.
- **Dependency:** `pdfjs-dist` 4.10.38 (Apache-2.0, engines node ≥20) + its optional `@napi-rs/canvas` 0.1.65 and 10
  platform packages (server-only, never used in the browser) — lock entries written from registry.npmjs.org on 2026-10-19.
  Ghostscript rejected (AGPL + ~15 MB).
- Audit: `merge_pdf` / `split_pdf` with counts + quality choice only, never file names.

### Reference: how 2.1 was set up (done)

Approved approach (product owner chose “option 1”: a real project dependency):

- **Dependency:** add `"pdf-lib": "^1.17.1"` to `package.json` and these entries to `package-lock.json`
  (versions + integrity hashes read from registry.npmjs.org on 2026-10-19 — no Node on the dev machine):
  - `node_modules/pdf-lib` 1.17.1 — sha512-V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw== (MIT)
    deps: pako ^1.0.11, tslib ^1.11.1, @pdf-lib/upng ^1.0.1, @pdf-lib/standard-fonts ^1.0.0
  - `node_modules/@pdf-lib/standard-fonts` 1.0.0 — sha512-hU30BK9IUN/su0Mn9VdlVKsWBS6GyhVfqjwl1FjZN4TxP6cCw0jP2w7V3Hf5uX7M0AZJ16vey9yE0ny7Sa59ZA== (MIT) deps: pako ^1.0.6
  - `node_modules/@pdf-lib/upng` 1.0.1 — sha512-dQK2FUMQtowVP00mtIksrlZhdFXQZPC+taih1q4CvPZ5vqdxR/LKBaFg0oAfzd1GlHZXXSPdQfzQnt+ViGvEIQ== (MIT) deps: pako ^1.0.10
  - `node_modules/pako` 1.0.11 — sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw== ((MIT AND Zlib))
  - `node_modules/pdf-lib/node_modules/tslib` 1.14.1 — sha512-Xni35NKzjgMrwevysHTCArtLDpPvye8zV/0E4EyYn43P7/7qvQwPh9BGkHewbMulVntbigmcT7rdX3BNo9wRJg== (0BSD)
    (nested because the app already has tslib 2.8.1 at the top level — leave that untouched)
- **File Tools page** (Workbench tab `wb_files`, route in `src/pages/workbench/WorkbenchApp.jsx`), first tool **Merge PDFs**:
  add PDFs (drag or pick, page count shown) → every page is a tile “File · p2” → drag to reorder,
  ✕ to delete, “Remove pages…” box (e.g. `2, 5–7`), move whole files up/down → file name (default
  `merged.pdf`) → Download. pdf-lib loaded lazily (only when File Tools opens).
- **Privacy:** banner “Files stay on this computer — nothing is uploaded”. Nothing goes to Supabase or any service.
- Password-protected / damaged PDFs → clear error message.
- **Not in 2.1:** page thumbnails (would need pdf.js — separate small step if wanted), split/compress (2.2).
- **Access:** open to all roles. **Audit:** one `merge_pdf` entry with counts only (files, pages) — never file names (may contain PHI).
- No database changes.

---

## ✅ Completed steps

| Step | What | Commit |
|---|---|---|
| 0.1 | Project audit → `docs/PROJECT_MAP.md` | 752717c |
| 0.2 | Workbench sidebar section + placeholder pages | 43e2535 |
| 0.3 | `users.team` + `users.is_qa` (Team page dropdown, QA flag, filter) | 95c6cd0 |
| 0.4 | Audit Log page, `entity_type/entity_id`, wider logging | 6e01a42 |
| 0.5 | Clients & Payers master lists, per-user access grants | 0fe00c4 |
| 1.1 | Payer Directory tables + `payers_edit` permission | 53a8290 |
| — | (off-roadmap) Every existing page grantable per user, scoped + view-only by default | 4a5dc34 |
| 1.2 | Payer type-ahead search with aliases, Payer Directory page | 1362acc |
| 1.3 | Full payer card with copy buttons and editor pop-ups | ec0dc6f |
| 1.4 | Payer form uploads (private bucket, versions) | 9be8833 |
| 1.5 | Client contract limits on the payer card | 33afba8 |
| 1.6 | Verified dates, “Report wrong info”, change history | baf408f |
| 1.7 | Excel import with skip / review-each-match | 3f2c275 |
| — | Progress handoff file + save-progress rule (CLAUDE.md rule 10) | c472fbf |
| 2.1 | File Tools: Merge PDFs (pdf-lib, in browser, reorder/delete pages) | f7ef920 |
| 2.2 | Split PDF + Original/Compress (High/Medium/Low) save step for all File Tools | 624b562 |
| 2.3 | Images → PDF (incl. multi-page TIFF) and Excel / CSV → PDF | f72b66e |
| 2.4 | PDF → Excel: in-browser extraction + method selector (B/C/D need admin setup + BAA) | cfb5f06 |
| 2.4b | OCR for scanned PDFs in the browser (Tesseract, bundled, yellow doubt highlights, Cancel) | 5b5c901 |
| 2.5 | Appeal Packet builder: sections, payer forms, cover sheet, page numbers, naming convention | b8abcef |
| 3.1 | SOP Library structure: Category → Software → Task → SOP, `sops_edit` | d8b2e16 |
| 3.2 | SOP page template: sections, numbered steps, edit content, verify, re-check badge, print | 0586f95 |
| 3.3 | SOP full-page editor, formatting, screenshots (paste, crop, black-out), short videos | b99691e |
| 3.4 | SOP versions (publish, effective dates, archive), client SOPs + copy, Acknowledge, read tracking | c7bb125 |
| 3.5 | Training page: learning paths by day, assign with due dates, my training, team progress, trainer confirm | 7d88686 |
| 3.6 | SOP quizzes: editor, take quiz with scores, tracking column, “Must pass the quiz” in learning paths | 67c73e9 |
| 3.7 | “Add standard software” (15 standard entries incl. Medicare DDE / MAC portals), no DB change | 98f21ea |
| 4.1 | Denial Navigator: denial library, code / ERA-line search, X12 import, starter codes, `denials_edit` | b583097 |
| 4.2 | Denial “What to do”: client → payer (+ Payer Directory info) → common steps, inline editing | bf44eb5 |
| 4.3 | Denial “Manage steps”: coverage + gaps, copy to client, Excel import / export, review queue, inactive (no DB change) | c58c595 |
| 4.4 | Deadline helper: due dates from payer / client limits, Medicare quick-fill, copy summary (no DB change) | c748f2c |
| 5.1 | Appeal Builder form: denial types + key facts, placeholders, side panel, in-memory only (no DB change) | 6b7e428 |
| 5.2 | Appeal letter templates: best-match letter filled locally, edit / copy / print, Templates tab, 8 starters | 83baf5c |
| 5.3 | AI wording for appeal letters: placeholders-only request, PHI block + confirm, answer checks, show changes (no DB change) | 974fc62 |
| 5.4 | Appeal PDF: fax cover (no PHI), cover letter, pre-filled payer form + field maps, deadline check, save step | 7ab604b |
| 5.5 | “Add to Appeal Packet”: letter + form + details handed to File Tools → Appeal Packet in memory (no DB change) | 3d52a5b |
| 6.1 | AR Tools + Claim Note Generator: dropdown notes in client formats, Note formats tab, 8 standard formats | 90ccc7d |
| 6.2 | AR Tools calculators: filing / appeal deadlines, NOA + PDGM + LUPA, NOE + hospice periods, expected payment (no DB change) | d016802 |
| 6.3 | Code lookup: CARC/RARC, revenue (starter + import), HIPPS decoder, ICD-10 (CMS file import), `ref_codes_edit` | c7ed1b5 |
| 6.4 | Smart Worklist: upload (patient columns dropped), priority bands, assign / auto-split, My worklist, Daily Report suggestion, 90-day clear | e2d9a0c |
| 6.5 | Follow-up tickler: Follow-ups tab (by date / payer), reminders, snooze, sign-in pop-up, sidebar count, browser notifications | d97fea6 |
| 6.6 | Portal launchpad: per-client software / payer portal / other links, ⭐ favourites, How-to SOPs, link checks, `portals_edit` | 10eb284 |
| 7.1 | QA Audits: scorecards + error categories linked to SOPs, audits, sampling from the Smart Worklist, acknowledge / dispute, results | f61896a |
| 7.2 | Error library “Mistakes & fixes”: search / filters, suggest → publish, starters, known mistake on QA fails, 📖 How to fix, seen-in-QA counts | 9c7a3c6 |
| 7.3 | Client Queries: log with Q-refs, chase every 3 working days (copy message), answer / close / escalate / reassign, history, aging per client + owner, Excel | 06b8177 |
| 7.4 | Handover & Escalations: per-person shift handover + carry-over items, team inbox with read tracking, escalation tracker (severity targets, history), overview + Excel | 10ce91c |
| 7.5 | Medicare Trackers: ADR tracker (+ ask client / escalate), overpayments & credit balances (60-day refund, quarter view), RTP / suspense monitor (FISS upload, patient columns dropped, auto-clear), overview + Excel | 3c9c8a4 |

---

## ⚠ Waiting on the product owner (Supabase)

Run in **Supabase → SQL Editor**, in this order, then click **↻ Sync structure** in the Owner Console:

1. `supabase/migrations/20261018_add_user_team.sql`
2. `supabase/migrations/20261018b_audit_log.sql`
3. `supabase/migrations/20261018c_clients_payers.sql`
4. `supabase/migrations/20261019_payer_directory.sql`
5. `supabase/migrations/20261019b_payer_forms_storage.sql`
6. `supabase/migrations/20261019c_payer_reports.sql`
7. `supabase/migrations/20261019d_sop_library.sql` (SOP Library, step 3.1)
8. `supabase/migrations/20261020_sop_template.sql` (SOP page template, step 3.2)
9. `supabase/migrations/20261020b_sop_media.sql` (SOP screenshots/videos bucket + `sop_media`, step 3.3)
10. `supabase/migrations/20261021_sop_versions.sql` (SOP versions, client SOPs, acknowledgements, step 3.4)
11. `supabase/migrations/20261021b_learning_paths.sql` (learning paths, assignments, progress, step 3.5)
12. `supabase/migrations/20261021c_sop_quizzes.sql` (SOP quizzes, attempts, `needs_quiz` on path items, step 3.6)
13. `supabase/migrations/20261021d_denial_codes.sql` (Denial library codes, step 4.1)
14. `supabase/migrations/20261021e_denial_steps.sql` (Denial Navigator layered steps, step 4.2)
15. `supabase/migrations/20261021f_appeal_templates.sql` (appeal letter templates, step 5.2)
16. `supabase/migrations/20261021g_payer_form_fields.sql` (field maps for fillable payer forms, step 5.4)
17. `supabase/migrations/20261021h_note_formats.sql` (claim note formats per client, step 6.1)
18. `supabase/migrations/20261021i_ref_codes.sql` (revenue / HIPPS / ICD-10 code lists, step 6.3)
19. `supabase/migrations/20261021j_worklists.sql` (Smart Worklist: worklists + minimum-field claim items, step 6.4)
20. `supabase/migrations/20261021k_followups.sql` (follow-up reminders, step 6.5)
21. `supabase/migrations/20261021l_client_portals.sql` (portal launchpad links per client, step 6.6)
22. `supabase/migrations/20261021m_qa_audits.sql` (QA scorecards, error categories, audits, step 7.1)
23. `supabase/migrations/20261021n_error_library.sql` (error library “Mistakes & fixes”, step 7.2)
24. `supabase/migrations/20261021o_client_queries.sql` (client query log + history, step 7.3)
25. `supabase/migrations/20261021p_handover_escalations.sql` (shift handovers, carry-over items, reads, escalations + history, step 7.4)
26. `supabase/migrations/20261021q_medicare_trackers.sql` (ADRs, overpayments / credit balances, RTP / suspense items + uploads, history, step 7.5)

The app hides/disables the related features until each one has been run, so code can deploy first.

---

## 📌 Decisions (don't re-ask)

- **Roles:** `users.role` stays the permission level (employee / supervisor / manager / admin). Functional team is `users.team`; QA is `users.is_qa`.
- **Access model (applies to every module):** each feature has role defaults, and an admin can grant it to any user on the Team page (“Extra access”). Registry: `src/lib/access.js` (`FEATURES`, `TAB_FEATURES`); grants in `users.access_grants`; sidebar via `withGrantedTabs` in `App.jsx`. Only admins can grant.
- **Granted pages for employees:** data limited to their own sub-processes (ALL = everyone); view-only unless an admin ticks actions in their Permissions. Team management, Settings, Work Allocation, Alloc Monitor, Feed Monitor are company-wide (warned in the UI).
- **Audit Log:** admins always; others only if granted.
- **Clients & Payers editing:** admins + managers by default, grantable.
- **Payer Directory:** viewing open to everyone; editing = `payers_edit` (admins + managers, grantable).
- **Payer accuracy:** verified per entry (not per field); 90-day re-check; reports resolved, never deleted.
- **Excel import duplicates:** user chooses per import — skip, or review each match side by side (keep / replace). Blank cells never erase.
- **PDF library:** pdf-lib as a real dependency (option 1), not a CDN. pdf.js (pdfjs-dist) added the same way for compression.
- **File Tools save step:** every output offers Original or Compress; levels are QUALITY (High = original quality, Medium = portal-friendly, Low = smallest readable) with an optional size limit.
- **PDF → Excel methods:** in-browser always available; Vercel / Supabase / own-server methods appear in a selector and only an admin can switch one on, with a “BAA signed” confirmation (audited). Config in kv `pdf_extract_engines` per company.
- **Appeal Packet:** cover sheet on by default; page numbers “Page X of Y” bottom right (optional prefix); company file-name convention set by `packet_settings` holders; `{PatientLast}` allowed but not default.
- **SOP Library:** viewing open to all (Published only); `sops_edit` (admins + managers, grantable) edits and sees Drafts. Categories are editable.
- **SOP page:** fixed template sections; SOPs need re-checking every 180 days (“Mark as verified today” by editors); “Who uses it” = team chips + free text.
- **SOP media:** up to 3 screenshots + 1 short video per step, optional walkthrough video; videos MP4/WEBM ≤ 25 MB / 3 min; every upload needs the no-PHI tick; screenshots can be cropped/blacked out in the browser; removing media only unlinks it.
- **SOP versions:** readers see only published versions (current = newest in effect); editors work on the working copy and publish with a change note + effective date; acknowledgement per version for the ticked teams (all if none); tracking via `sops_tracking` (admin/manager/supervisor); every user can see every client's SOPs (no user↔client link yet).
- **Training:** paths per team with Day 1…N; due dates skip weekends; SOP items complete on acknowledgement; people tick tasks/links unless “Trainer must confirm”; `training_manage` (admin/manager) builds/assigns, `training_track` (admin/manager/supervisor) sees progress + confirms; no auto-assign on user creation.
- **Quizzes:** one per SOP; multiple choice / True-False; 80% default pass mark; unlimited retakes; right answers shown only after passing; shuffled answers; quiz in a learning path = “Must pass the quiz” tick on SOP items (not a separate item kind); scoring in the browser (fine for internal checks, not formal certification).
- **Denial library:** full X12 CARC/RARC lists are not bundled — the company imports them from x12.org; imports never change our plain-English reasons; starter codes (our wording) must be verified; `denials_edit` (admin/manager) edits; pasted ERA lines are never saved.
- **Appeal Builder PHI:** the appeal form is never saved (DB, logs or browser storage) — memory only, wiped on refresh / sign-out / Clear; all dates, IDs, claim and auth numbers are identifiers and only ever leave the computer as placeholders.
- **AI wording:** Claude Opus 5.5 (medium effort, refusal fallback on), browser call with the Settings key; only the placeholder template + non-identifying facts are sent, PHI-like free text blocks sending, user confirms each time; open to everyone (no per-person switch-off).
- **Claim notes:** built in the browser, never saved / logged (last 5 in memory); formats per client + action with `[ … ]` optional parts; no patient-name placeholder; `note_formats` (admin/manager) manages formats.
- **Smart Worklist PHI (PO 2026-10-20):** no BAA with Supabase → worklists store minimum claim fields only (no patient name / DOB / member ID / MRN / address); claim # and DOS wiped on close or 90 days after upload; counts flow to the Daily Report only when the user confirms; Work Allocation stays as is.
- **Portal launchpad:** login pages only — never user names / passwords / PINs (notes and links mentioning them are refused); opening a portal is not logged; ⭐ favourites per browser; links re-checked every 180 days; `portals_edit` (admin/manager) sets each client up; “All clients” links show everywhere.
- **QA Audits:** separate from the Daily Report quality % and Quality Monitor (not linked — PO default 2026-10-21); auditors = QA flag + `qa_audit` (supervisors only their team / supervisees; admins, managers, QA everyone; nobody audits themselves); results are a copy of the checkpoints at audit time; critical fail = 0; overturned fails count as passes; comments checked with `phiIssues`; claim # wiped 90 days after closing; Excel has no claim numbers.
- **Error library:** a tab on QA Audits (everyone); anyone suggests, `mistakes_edit` (admin/manager) or the QA flag edits / publishes; general know-how only — all text checked with `phiIssues`, never tied to a claim; QA link stored as `mistake_id` inside `qa_audits.results`; 180-day re-check; “Seen in QA” = failed, not overturned, last 90 days.
- **Client Queries:** own sidebar page `wb_queries`; everyone sees all queries and changes their own (owner / creator), `queries_manage` (admin/manager/supervisor) changes anyone’s and reassigns; texts checked with `phiIssues` (dates blocked too); chase due = 3 working days since asked / last chased; claim # wiped 90 days after closing; Excel without claim #.
- **Handover & Escalations:** own sidebar page `wb_handover`; one handover per person per shift date (editable until the end of the next day); “For my team” = `scopePeople` (same team; supervisors + supervisees; admins / managers / QA everyone) for the last 2 shift dates; escalations visible to raiser / assignee, `escalations_manage` (admin/manager/supervisor) sees all + overview; targets Critical same day / High +1 / others +3 working days; escalated client queries shown read-only; all text via `phiIssues`; claim # wiped 90 days after done / closed.
- **Medicare Trackers:** own sidebar page `wb_medicare`; one config per tracker (`TRACKERS` in `medicareTrackers.js`) drives a shared editor + list; defaults ADR due = letter + 45, refund due = identified + 60, CMS-838 = quarter end + 30 (all labelled “check current rules”); RTP upload snapshot per client, claims missing from the new file → “Cleared from FISS”; `medicare_manage` (admin/manager/supervisor) uploads / assigns / changes all; claim # / DCN wiped 90 days after closed.
- **Nothing is ever deleted** — rows are made inactive; files/versions are kept.
- **Supabase migrations:** product owner runs them all at the end, one by one, from the ordered list here. Every feature must show “not set up yet” until its migration is run.

---

## 🛠 How work is done

- One roadmap step at a time: plan → product owner says “go” → build → tick `docs/HELIX_ROADMAP.md` → commit + push to `main`.
- Save points: approved plan is written here and pushed **before** building; long builds push checkpoints to the `wip` branch (never live); finished step goes to `main` and this file is updated.
- The dev machine has **no Node/npm**, so `npm run lint` / `npm run build` can't run locally — Vercel's deploy is the first build. Read changes carefully.
- Always `git fetch` first — GitHub is sometimes ahead.
- **Commit messages:** Windows PowerShell 5 breaks double quotes passed to git, so write the message to a file and use
  `git commit -F <file>`; and only reset/push `wip` after confirming the `main` commit succeeded.
- New tables/columns: new file in `supabase/migrations/`, additive only, then the product owner runs it and clicks **Sync structure**.
