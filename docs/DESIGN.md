# Helix Hub – Design System

One look for every page, based on the **Team Dashboard** (`.hx-*` styles in `src/index.css`), which is the best-looking page in the app.
Code: `src/components/ui/` (React components + `ui.css`). Import everything from one place:

```jsx
import { PageHeader, Card, CardSection, Item, Button, Tabs, Field, Check, FormActions,
         Table, Badge, Chip, Notice, Toolbar, ToolbarSpacer, EmptyState, Modal } from '../../components/ui';
```

**Rules of the system**

- Every style is under the `.ui-` prefix and built on the theme variables in `index.css`, so it works in all four themes
  (light, mist, dark, dusk) and does not change any page that doesn't use it.
- Don't add inline `style={{…}}` for colours, fonts, borders, radius or shadows. Use a component or a `.ui-` class.
  Inline styles are fine for one-off layout (a `maxWidth`, a grid column count).
- Restyling a page changes **markup and classes only**: never state, handlers, saves, wording or file output.

Pages using it today: **Payer Directory**, **Denial Navigator**, **Appeal Builder** and **File Tools** — plus the pieces they
share with other pages (the payer card in Credentialing / Ask Helix, the deadline helper in AR Tools). Every other page still uses
the older `.card` / `.btn-*` styles; move them over with the checklist in section 8.

Extra building blocks added while restyling (all in `ui.css`): `.ui-disclose` (collapsible card header), `.ui-layer` / `.hl`
(steps layers), `.ui-result` (status row with a coloured left edge), `.ui-paper` + `.ui-token` (letter preview and placeholder
highlight), `.ui-details`, `.ui-listrow`, `.ui-tick` (bare table checkbox), `.ui-drop` (file drop zone), `.ui-file-letter`,
`.ui-page-tile`. `Tabs` options can be `disabled`; `Card` takes an `id`.

---

## 1. Colours

Theme colours come from `index.css` and change with the theme. Always use the variable, never a hex value.

| Token | Use for |
|---|---|
| `--bg` | Page background (behind cards) |
| `--surface` | Cards, inputs, modals |
| `--surface-2` | Soft panels, tiles inside a card, table header |
| `--surface-3` | Hover on soft panels |
| `--border` | Every border and divider |
| `--text` / `--text-muted` / `--text-subtle` | Main text / labels and secondary text / placeholders |
| `--accent` / `--accent-dim` | Brand purple / focus ring and light purple fills |
| `--ui-grad` | **Brand gradient** purple → cyan (`--accent` → `#06b6d4`). Primary buttons, active tab, active chip, page-header icon |
| `--ui-accent-bg` | Light purple fill (accent badge, empty-state icon, ghost button hover) |

**Status tones** — used by `Badge`, `Notice`, `Button variant="danger" / "success"` and the `.ui-text-*` classes.
Light values are set on `:root`; dark and dusk switch automatically to brighter text on a deeper fill.

| Tone | Text | Fill | Means |
|---|---|---|---|
| `good` | `--ui-good` | `--ui-good-bg` | Done, verified, saved |
| `warn` | `--ui-warn` | `--ui-warn-bg` | Needs attention, due soon, re-check |
| `bad` | `--ui-bad` | `--ui-bad-bg` | Error, overdue, inactive, destructive |
| `info` | `--ui-info` | `--ui-info-bg` | Neutral fact worth noticing (payer type, tips) |
| `accent` | `--accent` | `--ui-accent-bg` | Helix Hub's own labels (client contract, “Starter”) |
| `neutral` | `--text-muted` | `--surface-2` | Everything else |

`--ui-mark-bg` / `--ui-mark` highlight a changed value or a placeholder (readable in dark mode too).

## 2. Fonts

| | Font | Where |
|---|---|---|
| Body | **Inter** (`:root` font-family) | All text |
| Display | **Outfit** (`--font-display`) | Page titles, card titles, section titles, big numbers |

Type scale (`--ui-fs-*`):

| Token | Size | Use |
|---|---|---|
| `xs` | 11 px | Badges, table headers, value labels (UPPERCASE + letter-spacing) |
| `sm` | 12.5 px | Secondary text, hints, toolbar text, small buttons |
| `base` | 13.5 px | Body text, inputs, buttons, table cells |
| `md` | 16 px | Card titles, modal titles, big values |
| `lg` | 20 px | The record being worked on (payer name) |
| `xl` | 28 px | Page title (scales down to 22 px on phones) |

Numbers that line up in columns use `font-variant-numeric: tabular-nums` (`.num` in tables, `.ui-kv-v.big`).

## 3. Spacing, corners, shadows

**Spacing** — 4 px scale: `--ui-s1` 4 · `--ui-s2` 8 · `--ui-s3` 12 · `--ui-s4` 16 · `--ui-s5` 20 · `--ui-s6` 24 · `--ui-s8` 32.

- Between cards on a page: 16 (`.ui-page` does this).
- Inside a card: 16 × 20 padding; 12 between rows; 16 above a new section.
- Between buttons in a row: 8 (4 for the tiny buttons on a tile).

**Corners** — `--ui-r-sm` 10 (inputs, buttons, notices) · `--ui-r` 16 (cards, tables) · `--ui-r-lg` 20 (page header, modals) · `--ui-r-pill` (tabs, chips, badges).

**Shadows** — cards: `--ui-ring` + `--shadow` (a faint purple outline plus a soft drop). The item being worked on (`Card variant="accent"`) and modals: stronger purple ring + `--shadow-md` / `--shadow-lg`. Soft panels have no shadow.

---

## 4. Components

### PageHeader
The top of every page. A smaller version of the Team Dashboard hero.

```jsx
<PageHeader icon="📇" kicker="Workbench" title="Payer Directory"
  subtitle="Find any payer by its name or a short name like “BCBSTX”."
  actions={<Button size="sm">⬆ Import from Excel</Button>} />
```
- One per page, always first. `kicker` = the sidebar area (e.g. *Workbench*, *Monitoring*).
- `actions` = at most 2–3 page-wide buttons; they drop below the title on phones.

### Card, CardSection, Item
```jsx
<Card title="All payers (12)" actions={<Toolbar>…</Toolbar>}>…</Card>
<Card variant="accent">…the record being worked on…</Card>
<Card variant="soft" title="Change history" icon="🕘">…</Card>

<CardSection icon="☎️" title="Contacts" actions={<Button size="sm">+ Add Contact</Button>}>
  <div className="ui-grid">
    <Item dim={inactive}>…one entry…</Item>
  </div>
</CardSection>
```
- `default` for lists and tools · `accent` for the one record open right now · `soft` for secondary panels inside a card.
- `flush` removes the padding (for a table that should touch the card edge). `dim` fades an inactive card.
- Values inside an item: `<div className="ui-kv-l">Phone</div><div className="ui-kv-v">…</div>` (`.big` for the key number).

### Button
```jsx
<Button variant="primary" onClick={save} loading={saving}>Save</Button>
<Button onClick={close}>Cancel</Button>                {/* secondary is the default */}
<Button variant="ghost" size="sm">✕ Close</Button>
<Button variant="danger" size="xs">Make Inactive</Button>
<LinkButton onClick={toggle}>▸ Older versions (3)</LinkButton>
```
- **One primary button per area** (the main action of that form / card). Everything else secondary or ghost.
- `danger` for make-inactive / remove; `success` for reactivate. Sizes: `md` 36 px · `sm` 30 px · `xs` 24 px (tile actions).
- File pickers: `<label className="ui-btn primary">⬆ Choose file<input type="file" hidden /></label>`.
- Don't: use colour-only inline styles on buttons; put two primary buttons side by side.

### Tabs
```jsx
<Tabs value={tab} onChange={setTab} options={[{ value: 'lookup', label: '🔎 Look up' }, { value: 'manage', label: '🛠 Manage steps' }]} />
```
The Team Dashboard's Day / Week / Month switch. Use for the views at the top of a module. They wrap on phones.

### Field, Check, FormActions
```jsx
<Field label="Payer ID" required hint="e.g. 84980" error={err}>
  <input value={v} onChange={e => setV(e.target.value)} />
</Field>
<Check checked={verify} onChange={e => setVerify(e.target.checked)}>I confirmed this with the payer</Check>
<Check type="radio" name="mode" checked={mode === 'skip'} onChange={() => setMode('skip')}>Skip them</Check>
<Check inline checked={showInactive} onChange={…}>Show inactive</Check>   {/* toolbar size */}
<FormActions><Button>Cancel</Button><Button variant="primary">Save</Button></FormActions>
```
- `Field` styles the plain `<input> / <select> / <textarea>` inside it, so existing `value` / `onChange` code is untouched.
- **Always use `Check` for checkboxes and radios.** The global `input { width: 100% }` rule otherwise squeezes the label into a narrow column.
- Side-by-side fields: wrap them in `<div className="ui-grid2">` (two columns that stack on phones).
- `FormActions split` puts the first button on the left (e.g. *← Back*) and the rest on the right.

### Table
```jsx
<Table dense maxHeight={360}>
  <thead><tr><th>Tab</th><th className="num">New</th></tr></thead>
  <tbody><tr><td>Payers</td><td className="num">12</td></tr></tbody>
</Table>
```
Rounded, sticky header, scrolls sideways inside itself on phones. Cell classes: `num` (right-aligned numbers), `muted`, `mark` (highlighted / changed value). Clickable rows: `<tr className="click">` **plus** a real button or link in the row for keyboard users.

### Badge, Chip, Notice
```jsx
<Badge tone="good">Verified</Badge>   <Badge tone="bad">Inactive</Badge>   <Badge tone="accent">Client contract: ABC</Badge>
<div className="ui-chips"><Chip on={selected} onClick={pick}>Aetna</Chip></div>
<Notice tone="warn">⚠ Blank forms only — never upload a form that contains patient information.</Notice>
<Notice tone="bad">{error}</Notice>
```
- Badges are labels, not buttons. Chips are buttons (A–Z lists, quick picks).
- Use `Notice` for every warning, error and success message, not a coloured `<p>`.

### Toolbar
```jsx
<Toolbar>
  <select>…</select> <select>…</select>
  <ToolbarSpacer />
  <Button size="sm">Export</Button>
</Toolbar>
```
Filters on the left, actions on the right; wraps on phones. Selects placed directly inside get the right width.

### EmptyState
```jsx
<EmptyState icon="📇" title="No payers yet.">Admins and managers can add them in Clients & Payers.</EmptyState>
<EmptyState compact title="Nothing recorded yet — click “+ Add Contact”." />
```
Full version for an empty page or list; `compact` for an empty section inside a card. Also used for "Loading…" and "isn't set up yet" messages.

### Modal
```jsx
{open && <Modal title="Add Contact — Aetna" onClose={() => setOpen(false)} wide>…<FormActions>…</FormActions></Modal>}
```
Same props as the old `components/shared/Modal`, but drawn on `<body>` with a full-screen backdrop. The old one was clipped by
the page's fade-in animation (a CSS transform traps `position: fixed`). Escape or a click on the backdrop closes it.
Confirm dialogs (`confirmDialog`) still appear above it.

---

## 5. Page anatomy

```
.ui-page (max-width per page, centred, 16 px between blocks)
├── PageHeader                       icon · kicker · title · subtitle · actions
├── Tabs (if the module has views)
├── Card — search / filters (Toolbar)
├── Card variant="accent" — the record being worked on
│     ├── header row: name · badges · actions (ghost "✕ Close" last)
│     └── CardSection × n → .ui-grid of Item tiles
└── Card — the list (Table or chips), EmptyState when empty
```

## 6. Dark mode

- Use theme variables and tone tokens only. Hard-coded light colours (`#fff`, `rgba(245,158,11,…)`, `color: #000`) are what made
  text invisible in dark mode before (Medicare tiles, letter placeholders).
- Highlights use `--ui-mark-bg` / `--ui-mark`, never a fixed yellow with inherited text.
- Check every restyled page with the theme switch in the sidebar (🌙), in both light and dark.

## 7. Phones (≤ 640 px)

- No page may scroll sideways. Tables scroll inside `Table`; everything else wraps.
- The page header stacks (actions full width below the title); grids become one column; modals get 12 px margins.
- Touch targets: buttons are at least 30 px high (`xs` 24 px only for secondary tile actions).

## 8. Moving another page onto the system (checklist)

1. Wrap the page in `<div className="ui-page" style={{ maxWidth: … }}>` and replace the old `page-header` with `PageHeader`.
2. `card` → `Card`, `card-header` / `card-title` → `Card title / actions`, bordered sub-blocks → `CardSection` / `Item`.
3. `btn-primary` → `Button variant="primary"`, `btn-sm` → `Button size="sm"`, coloured `btn-sm` → `variant="danger" / "success"`.
4. `.field` + `<label>` → `Field`; every checkbox / radio → `Check`; `.form-actions` → `FormActions`.
5. `badge badge-*` → `Badge tone`, coloured `<p>` / `<div>` messages → `Notice`, "Nothing yet" text → `EmptyState`.
6. `components/shared/Modal` → `Modal` from `components/ui` (same props).
7. Remove inline colours, borders, radii and font sizes. Keep every handler, state variable and piece of wording as it was.
8. `npm run lint` + `npm run build`; check light, dark and 375 px; repeat the page's add / save / reload test.
