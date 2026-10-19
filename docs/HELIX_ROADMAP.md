# Helix Hub – Product Roadmap

Product owner: Faiz (AR Team Lead, 3Gen)
Goal: turn Helix Hub from a production/quality tracker into the daily workbench that makes RCM users faster and more accurate.

How we build: one step at a time → test → git commit → next step. Tick `[x]` when a step is done and tested.

---

## Phase 0 – Audit & foundation
- [x] 0.1 Project audit: list existing modules, pages, Supabase tables, auth/roles. Write it to `docs/PROJECT_MAP.md`. No code changes.
- [x] 0.2 Shared navigation: add a "Workbench" section to the sidebar for the new modules (empty placeholder pages).
- [x] 0.3 Roles: confirm/extend roles (Admin, Team Lead, AR, Auth, Billing/Posting, Coding, Credentialing, QA).
- [x] 0.4 Audit log table + helper: who did what, when, on which record.
- [x] 0.5 Master tables: `clients` (agencies we bill for) and `payers` (base payer list with aliases).

## Phase 1 – Payer Directory
- [x] 1.1 Tables: payers, payer_plans (line of business, IPA/delegated groups, BlueCard home/host), payer_ids (by clearinghouse, direct), payer_contacts (claims, auth, appeals, provider relations: phone, fax, email, mailing address, attention line), payer_limits (TFL, CCTFL, AFL, recon levels), payer_forms, payer_notes.
- [x] 1.2 Search dropdown: type-ahead with aliases (e.g. "BCBSTX", "Blue Cross Texas").
- [ ] 1.3 Payer card: all info on one page, copy button on every field, portal links.
- [ ] 1.4 Forms: upload/download appeal, recon, auth and corrected-claim forms (Supabase storage) with version date.
- [ ] 1.5 Client overrides: TFL/AFL etc. per client contract; card shows the selected client's values.
- [ ] 1.6 Accuracy: "last verified" date + owner per field, "Report wrong info" button, change log, flag if not verified in 90 days.
- [ ] 1.7 Excel import template + importer for bulk loading payer data.

## Phase 2 – File Tools
- [ ] 2.1 Merge PDFs (in browser), reorder pages, delete pages.
- [ ] 2.2 Split PDF, compress PDF.
- [ ] 2.3 Excel → PDF, image → PDF.
- [ ] 2.4 PDF → Excel (table extraction on our own server).
- [ ] 2.5 Appeal Packet builder: cover letter + form + EOB + auth approval + MR in order, page numbers, file naming convention.

## Phase 3 – SOP & Training Library
- [ ] 3.1 Structure: Software → Task → SOP; categories (EMR, Clearinghouse, Payments/ERA, Payer portals, Medicare DDE).
- [ ] 3.2 SOP page template: Purpose, Who uses it, Before you start, numbered Steps with screenshots, What you should see, If it goes wrong, Last verified + owner.
- [ ] 3.3 SOP editor + upload (text, screenshots, short videos). Reminder banner: no PHI in screenshots.
- [ ] 3.4 Versioning: client-specific vs common SOPs, effective dates, archive old versions, "Acknowledge" button + read tracking.
- [ ] 3.5 Learning paths by role (e.g. new AR joiner Day 1–5) with completion tracking.
- [ ] 3.6 Quizzes per SOP (3–5 questions) with scores.
- [ ] 3.7 Seed software list: Waystar, Availity, ECHO, PaySpan, WellSky (Kinnser), Axxess, HCHB, Inovalon, NaviNet, payer portals, Medicare FISS DDE (Palmetto, CGS, NGS – incl. hospice).

## Phase 4 – Denial Navigator
- [ ] 4.1 Denial library: CARC/RARC codes + plain-English denial reasons + search.
- [ ] 4.2 Layered steps: Client SOP (top, highlighted) → Payer rule (from Payer Directory) → Common 3Gen steps.
- [ ] 4.3 Admin screen to add/update denial steps per client and common.
- [ ] 4.4 Deadline helper: appeal/corrected-claim deadline from denial date using payer/client limits.

## Phase 5 – Appeal Builder
- [ ] 5.1 Form: client, payer, denial reason, claim #, DOS, key fact (e.g. auth # + approval date).
- [ ] 5.2 Letter templates per denial type, using placeholders only.
- [ ] 5.3 AI wording (no PHI sent) → real values filled locally → preview → edit.
- [ ] 5.4 Output PDF cover letter, pre-filled payer form, payer address/fax from directory, AFL deadline check.
- [ ] 5.5 "Add to Appeal Packet" (links to 2.5).

## Phase 6 – Daily AR productivity
- [ ] 6.1 Claim Note Generator: dropdowns → note in each client's note format.
- [ ] 6.2 Calculators: TFL/AFL deadline, NOA/NOE due date, PDGM 30-day periods, LUPA, hospice benefit periods, expected payment/sequestration.
- [ ] 6.3 Code lookup: CARC/RARC, revenue codes, HIPPS, ICD-10.
- [ ] 6.4 Smart Worklist: upload aging/RTP file → prioritise by deadline, $ and payer → assign to users → auto-update production counts.
- [ ] 6.5 Follow-up tickler (reminders per claim).
- [ ] 6.6 Portal launchpad per client.

## Phase 7 – Quality & team
- [ ] 7.1 QA Audit module: sampling, scorecards, error categories, agent acknowledgment, link each error to its SOP.
- [ ] 7.2 Error library ("mistakes and fixes").
- [ ] 7.3 Client Query Log with aging.
- [ ] 7.4 Shift handover notes + escalation tracker.
- [ ] 7.5 Medicare trackers: ADR tracker, recoupment/credit balance tracker, RTP/suspense monitor.

## Phase 8 – Payer Updates Feed
- [ ] 8.1 Upload payer bulletin PDF → AI extracts rows (payer, effective date, change, teams affected, action needed). Bulletins contain no PHI.
- [ ] 8.2 Searchable list, Excel download, notify affected teams.
- [ ] 8.3 Suggest updates to the Payer Directory from bulletins (admin approves).

## Phase 9 – AI Assistant
- [ ] 9.1 Assistant that searches Payer Directory, SOPs, Denial Navigator and Payer Updates (PHI-free mode, de-identify input).
- [ ] 9.2 Auth assistant.
- [ ] 9.3 Credentialing assistant (status checklist, CAQH/revalidation reminders).
- [ ] 9.4 Coding assistant (MR/OASIS → code suggestions with evidence, coder approves). REQUIRES BAA-covered AI, hosting and database + compliance sign-off before starting.

## Phase 10 – Platform
- [ ] 10.1 Global search (Ctrl+K) across all modules.
- [ ] 10.2 Reports: denial trends by payer/client, weekly client reports.
- [ ] 10.3 Announcements board.
- [ ] 10.4 Chrome extension sidebar (later).

---

## Success metrics
Denials worked per hour · time to build an appeal · appeal overturn rate · QA errors from missed client SOPs · new-joiner ramp-up time.
