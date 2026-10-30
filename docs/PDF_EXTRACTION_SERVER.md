# PDF → Excel extraction service — setup guide

Helix Hub's **PDF → Excel** tool (File Tools) can read PDFs in the browser (method A, always available) or send them
to an extraction service that **you** run. This guide is for whoever builds that service (methods B, C or D).

## ⚠ HIPAA first

PDFs sent to the service can contain patient information. **Do not switch a method on until a signed BAA (Business
Associate Agreement) covers the provider hosting it.** In Helix Hub only an **admin** can switch a method on, and they must
tick “We have a signed BAA”. Both actions are written to the Audit Log.

| Method | Where | BAA needed from |
|---|---|---|
| B | Vercel serverless function (e.g. `/api/pdf-to-excel` in this repo) | Vercel (Enterprise plan) |
| C | Supabase Edge Function | Supabase (Team plan + HIPAA add-on) |
| D | Your own server (AWS / Azure / Google Cloud) | That cloud provider |

The service must not keep the PDF or the results after answering, and must not log their contents.

## What Helix Hub sends

`POST` to the address the admin entered (B, D) or the Edge Function name (C), as `multipart/form-data`:

| Field | Value |
|---|---|
| `file` | The PDF |
| `pages` | Optional. Comma-separated 1-based page numbers, e.g. `2,3,4,8`. Missing = all pages. |

Headers: if the admin entered an access key (B, D): `Authorization: Bearer <key>`.
For C, Supabase adds its own headers automatically.

The browser calls the service directly, so for D (and B on another domain) the service must allow the Helix Hub site
in its **CORS** settings (`Access-Control-Allow-Origin`, and `Authorization` in `Access-Control-Allow-Headers`).
The app waits up to **3 minutes**.

## What the service must answer

HTTP 200 with JSON:

```json
{
  "pages": [
    { "page": 1, "rows": [["Claim #", "DOS", "Billed", "Paid"], ["A123", "01/02/2026", "$150.00", "$97.50"]] },
    { "page": 2, "rows": [], "scanned": true }
  ]
}
```

- `rows` — the table text, row by row, each cell a string (keep amounts as they appear, e.g. `$1,234.56`; Helix Hub
  converts them to numbers if the user asks).
- `scanned` — `true` when the page is an image and nothing could be read (optional).
- Any non-200 answer is shown to the user as an error.

## Suggested building blocks

- **Python** (B on Vercel, or D): `pdfplumber` or `camelot` for digital PDFs; `ocrmypdf` / Tesseract for scanned PDFs.
- **JavaScript / Deno** (C): `pdfjs-dist` text positions (the same approach Helix Hub uses in the browser — see `src/lib/pdfExtract.js`).

## Layouts (proper format)

Whatever method is used, Helix Hub turns the result into a proper table in the browser (`src/lib/pdfStructure.js`):
Structured table, Records (Label: value) or As on page. Browser methods also keep each word's position, which lines
columns up best. A service only returns `rows`, so Helix Hub lines its cells up by column number. **Return one cell per
column** (not a whole line in one cell) for the best result.
