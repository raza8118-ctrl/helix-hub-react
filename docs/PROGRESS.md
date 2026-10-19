# Helix Hub – Build Progress & Handoff

**Read this first in every new session.** It records where the build is, what was decided and
what still has to be done, so work can continue even if a session ends mid-step.
Updated at the start of every step (approved plan) and at the end (result).

_Last updated: 2026-10-19_

---

## ▶ Current step

**2.2 Split PDF + compress** — **APPROVED (“go” 2026-10-19), building.** Engine: pdf.js (pdfjs-dist) as a real dependency.
Build checkpoints go to the `wip` branch; if a session ends mid-build, continue from `origin/wip`.

**Product owner requirement (2026-10-19):** whenever File Tools produces a file (merge, split, anything later), the
save step offers **“Keep original size & quality”** or **“Compress”**; choosing Compress offers **Low / Medium / High**
and the file is processed accordingly. This also applies retroactively to Merge (2.1).

**Clarified (2026-10-19): the levels are QUALITY levels.**
- **High** = original quality — lossless; pages untouched, only a lossless repack; never larger than the original.
  (True “enhancement” beyond the source isn't possible and filters would alter medical documents — explained to the PO.)
- **Medium** = smaller for portals, very readable (image pages ≈150 dpi, JPEG ~0.75).
- **Low** = smallest, still readable (image pages ≈110 dpi, JPEG ~0.6). Never below ~100 dpi (readability floor).
- Optional **“Must be under __ MB”** (portal limit): steps down Medium → Low automatically, never below the floor; says so if it can't fit.
- Shows “Original X MB → New Y MB”; if a level doesn't shrink the file, the original is kept and the user is told.

Recommended engine (pending confirmation): pdf.js (Apache-2.0) renders only pages that contain scanned images
and re-saves them as JPEG at the chosen level; text-only pages are copied untouched so their text stays selectable.
Ghostscript-in-browser rejected for now: AGPL licence + ~15 MB download.

Notes for 2.2: File Tools lives in `src/pages/workbench/FileTools.jsx` (tool buttons at the top; “Split / Compress” is a disabled placeholder) and `src/lib/pdfTools.js` (pdf-lib helpers). pdf-lib can split easily; real compression (re-encoding images) is limited in pdf-lib — raise that with the product owner when planning.

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

---

## ⚠ Waiting on the product owner (Supabase)

Run in **Supabase → SQL Editor**, in this order, then click **↻ Sync structure** in the Owner Console:

1. `supabase/migrations/20261018_add_user_team.sql`
2. `supabase/migrations/20261018b_audit_log.sql`
3. `supabase/migrations/20261018c_clients_payers.sql`
4. `supabase/migrations/20261019_payer_directory.sql`
5. `supabase/migrations/20261019b_payer_forms_storage.sql`
6. `supabase/migrations/20261019c_payer_reports.sql`

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
- **PDF library:** pdf-lib as a real dependency (option 1), not a CDN.
- **Nothing is ever deleted** — rows are made inactive; files/versions are kept.

---

## 🛠 How work is done

- One roadmap step at a time: plan → product owner says “go” → build → tick `docs/HELIX_ROADMAP.md` → commit + push to `main`.
- Save points: approved plan is written here and pushed **before** building; long builds push checkpoints to the `wip` branch (never live); finished step goes to `main` and this file is updated.
- The dev machine has **no Node/npm**, so `npm run lint` / `npm run build` can't run locally — Vercel's deploy is the first build. Read changes carefully.
- Always `git fetch` first — GitHub is sometimes ahead.
- New tables/columns: new file in `supabase/migrations/`, additive only, then the product owner runs it and clicks **Sync structure**.
