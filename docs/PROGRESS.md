# Helix Hub – Build Progress & Handoff

**Read this first in every new session.** It records where the build is, what was decided and
what still has to be done, so work can continue even if a session ends mid-step.
Updated at the start of every step (approved plan) and at the end (result).

_Last updated: 2026-10-19_

---

## ▶ Current step

**2.4b OCR for scanned PDFs** — **APPROVED (“go” 2026-10-19), building.** Checkpoints on `wip`; if a session ends mid-build, continue from `origin/wip`. Any new File Tools PDF output must use `PdfSaveOptions.jsx`.

Draft plan:
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
| 2.4b | OCR for scanned PDFs in the browser (Tesseract, bundled, yellow doubt highlights, Cancel) | see `git log` (step 2.4b) |

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
- **PDF library:** pdf-lib as a real dependency (option 1), not a CDN. pdf.js (pdfjs-dist) added the same way for compression.
- **File Tools save step:** every output offers Original or Compress; levels are QUALITY (High = original quality, Medium = portal-friendly, Low = smallest readable) with an optional size limit.
- **PDF → Excel methods:** in-browser always available; Vercel / Supabase / own-server methods appear in a selector and only an admin can switch one on, with a “BAA signed” confirmation (audited). Config in kv `pdf_extract_engines` per company.
- **Nothing is ever deleted** — rows are made inactive; files/versions are kept.

---

## 🛠 How work is done

- One roadmap step at a time: plan → product owner says “go” → build → tick `docs/HELIX_ROADMAP.md` → commit + push to `main`.
- Save points: approved plan is written here and pushed **before** building; long builds push checkpoints to the `wip` branch (never live); finished step goes to `main` and this file is updated.
- The dev machine has **no Node/npm**, so `npm run lint` / `npm run build` can't run locally — Vercel's deploy is the first build. Read changes carefully.
- Always `git fetch` first — GitHub is sometimes ahead.
- New tables/columns: new file in `supabase/migrations/`, additive only, then the product owner runs it and clicks **Sync structure**.
