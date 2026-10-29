# Helix Hub – Project Map

Roadmap step 0.1 audit, done 2026-10-18 at commit `1697eb8`. No code was changed.

## 1. Stack (as it actually is)

| | CLAUDE.md says | Code actually uses |
|---|---|---|
| Framework | Next.js | **Vite + React 19 single-page app**: no Next.js, no server routes, no API folder |
| Routing | – | No router. `App.jsx` picks a tab list by role; `AdminApp` / `SupervisorApp` / `EmployeeApp` switch on tab id |
| Database | Supabase | Supabase, schema `rcm`, called **directly from the browser** with the public anon key |
| Auth | Supabase auth | **Custom**: `users` table with plain-text passwords, session kept in `sessionStorage` |
| Storage | Supabase storage | Bucket `feed-media` (public URLs): Team Feed and Announcement images only |
| Other libs | – | `xlsx` (Excel import/export), `@dnd-kit` (drag and drop), Giphy, Anthropic API (from the browser) |
| Env vars | `.env.local` | `VITE_SUPABASE_URL`, `VITE_ANTHROPIC_KEY` (actually holds the **Supabase anon key**), optional `VITE_COMPANY_NAME` / `VITE_COMPANY_CODE` |

Scripts: `npm run dev`, `build`, `lint`, `preview`.

## 2. Folder layout

```
src/
  App.jsx                 app shell, role → tab list, session restore, banners
  components/
    Login.jsx             company step → Employee ID + password; owner sign-in link
    Sidebar.jsx           left nav, built from the tab list (grouped by `section`)
    shared/               BarChart, LineChart, Dialog (confirm/prompt), Modal, Toast, UI,
                          Profile, EmpDetail, FriendsPanel, CommentThread, Discussion,
                          ReactionBar, EmojiPicker, Starfield
  lib/
    supabase.js           client, company table prefix, S (get/set/del/update), kv, storage
    company.js            company profile, company lookup, owner session + owner RPCs
    constants.js          processes, default tasks/targets, themes, shift slots, Keka fields
    helpers.js            productivity maths, supervisor scoping, permsFor, logAudit, callAI, Excel parse
    giphy.js
  pages/
    admin/                13 pages (also reused by supervisors)
    supervisor/           SupervisorApp router + SupervisorTeam
    employee/             6 pages
    owner/OwnerConsole.jsx
supabase/multi_company_setup.sql   the only SQL in the repo
```

## 3. Modules and pages

### Admin / Manager (`ADMIN_TABS`)
| Section | Tab | File | What it does |
|---|---|---|---|
| Monitoring | Team Dashboard (`teamdash`) | `admin/TeamDashboard.jsx` | One page for productivity, quality, attendance (Keka fields) and calls — team or one person, day / week / one or more months; tiles with mini trends + vs previous period, dark chart panel, heat grid, rankings, needs-attention list, team table; click any number for the records (Excel, audit-logged). Maths in `lib/teamDashboard.js`, parts in `components/dash/` (own SVG, `.hx-*` CSS) |
| | Attendance (Keka) (`dashboard`) | `admin/Dashboard.jsx` | Keka attendance import (column-mapping wizard), attendance detail, recent imports |
| | Today | `admin/Today.jsx` | Today's submissions, prod/quality averages, holiday marking, CSV export, AI summary email |
| | Prod Monitor | `admin/ProdMonitor.jsx` | Daily logs per employee; edit counts, deadline bypass, quality bypass, pin employees |
| | Quality | `admin/QualityMonitor.jsx` | Multi-day quality grid, edit quality % |
| | Hourly | `admin/HourlyMonitor.jsx` | Hourly slot counts (US-shift slots in IST, DST toggle), edit counts |
| | Weekly / Monthly | `admin/Summary.jsx` | Performance summary charts, rankings, calls, CSV export, AI recap email |
| Team | Team | `admin/TeamMgmt.jsx` | User directory, roles, permissions, projects and sub-processes, password-reset approvals |
| | Work Alloc | `admin/WorkAllocation.jsx` | Upload Excel worklist, filter/sort, preview, assign rows to employees |
| | Alloc Monitor | `admin/AllocMonitor.jsx` | Progress on allocations |
| Engagement | Announcements | `admin/AdminFeedback.jsx` | Announcements/feedback to all or one employee, priority, images, acknowledgements |
| | Team Feed | `employee/TeamFeed.jsx` | Social feed: posts, comments, reactions, GIFs, visibility |
| | Feed Monitor | `admin/FeedMonitor.jsx` | Moderate feed posts |
| System | Settings | `admin/Settings.jsx` | Anthropic API key, shift timing (DST), task target configuration |

### Supervisor (`SUPERVISOR_TABS`)
Team Dashboard, Attendance (Keka), Today, Prod Monitor, Hourly, Weekly, Monthly (same admin pages, scoped to the supervisor's team), **My Team** (`supervisor/SupervisorTeam.jsx`, team list + reset approvals), Announcements, Team Feed. No Quality, Team, Allocation or Settings tabs.

### Employee (`empTabs`)
| Tab | File | What it does |
|---|---|---|
| Daily Report | `employee/ProdReport.jsx` | Enter daily task counts, attendance, downtime, calls, remarks; live prod % / deficit |
| My Reports | `employee/MyReports.jsx` | Own history |
| Progress | `employee/Progress.jsx` | Own trend charts |
| My Allocation | `employee/MyAllocation.jsx` | Rows assigned to me from Work Alloc |
| Announcements | `employee/EmpFeedback.jsx` | Read and acknowledge (unread count in the tab label) |
| Team Feed | `employee/TeamFeed.jsx` | Social feed |

Banners: missed-report reminder (employees), "Below target" badge (admins), purple owner banner.

### Helix Hub Owner Console (`owner/OwnerConsole.jsx`)
A separate login. Owner Console 2.0 (2026-10-29) has 5 tabs: **Overview** (platform totals, a card per company with users / seats, sign-ins, reports, Prod % this week, last activity, structure check, alerts; Open → with a start page), **Companies** (list, add, rename, pause / resume, **Manage** → `owner/CompanyManage.jsx`: plan, seat limit, banner, contact + private notes, pages on / off, users with last sign-in + reset password / switch off / 🔑 sign in as, activity, sign everyone out, delete), **Broadcasts**, **Owners & security** (owner accounts, owner activity log, password) and **Platform** (structure check, sync, Changelog) — the last three in `owner/OwnerTabs.jsx`. Calls in `lib/owner.js` (owner RPCs from migration 34, per-company stats read with the table prefix). Page on / off list + AI switch: `lib/companyFeatures.js` (App hides switched-off tabs; every AI call checks `assertAiAllowed`). App watches the company row every 2 min (pause / sign everyone out → `kickOut`, login shows the message); banners: `components/shared/PlatformBanners.jsx`; seat limit: `company.seatLimitProblem` in TeamMgmt. Audit entries made through the master key read “Name (via Helix Hub owner X)”.

### Productivity model (core business logic, `lib/helpers.js` + `ProdReport.jsx`)
Projects → sub-processes (home company: project `PMB` with MCO, MCD, MCR, AUTH). Each process has tasks with daily targets (`DEFAULT_TASKS`, overridable in `task_configs`). Prod % is weighted by target, adjusted for downtime and half-days. There is a frozen "Legacy Auth" formula for AUTH-only users before 2026-06-16. Quality can be skipped per process (`quality_skip_procs`), which auto-locks it to 100%.

## 4. Supabase tables (schema `rcm`)

Each added company has a copy of every table named `co_<code>__<table>`. The home company (3Gen) uses the unprefixed tables.

| Table | Used for | Main pages |
|---|---|---|
| `users` | Logins, profile, role, processes/access, target, supervisor links, permissions, avatar | Login, TeamMgmt, everywhere |
| `daily_logs` | One row per employee per day: counts, total, target/adj_target, prod %, quality, attendance, downtime, calls, bypass flags | ProdReport, monitors, Summary |
| `hourly_logs` | Hourly slot counts | ProdReport, HourlyMonitor |
| `task_configs` | Per-process task list and targets | Settings, ProdReport |
| `processes` | Custom projects/sub-processes (and the full process list for added companies) | TeamMgmt, filters |
| `holidays` | Holiday dates | Today, missed-report check |
| `allocations` | Allocation header (who, when, filters) | WorkAllocation, AllocMonitor, MyAllocation |
| `keka_imports` | Keka attendance import history | Dashboard |
| `feedback`, `feedback_acks` | Announcements and acknowledgements | Announcements pages, unread count |
| `feed_posts`, `feed_comments`, `feed_reactions` | Team Feed | TeamFeed, FeedMonitor |
| `friend_requests`, `close_friends` | Feed visibility | TeamFeed, FriendsPanel |
| `reset_requests` | Password-reset requests | TeamMgmt, SupervisorTeam |
| `audit_log` | Who did what to whom (write-only today) | `logAudit()` in helpers |
| `call_logs` | Only ever deleted (EmpDetail); nothing writes it | – |
| `rcm_store` | Key/value store (see below) | `kv` helper |
| `companies` | Company registry (not copied); since migration 34 also features (pages off), plan, seat_limit, pause_message, banner, session_version | Login, App, Owner Console |
| `helix_company_private`, `helix_owner_log` | Owner-only: company contact / notes, log of every owner action (no API access — owner RPCs only; never copied) | Owner Console |
| `helix_broadcasts` | Owner banners for all / chosen companies (readable, written by owner RPC; never copied) | App banners, Owner Console |
| `helix_owners` | Owner logins (not copied, not readable via API) | `owner_login` RPC only |

**`rcm_store` keys:** `company_profile`, `prefs_<emp_id>` (theme), `anthropic_key`, `shift_dst`, `quality_skip_procs`, `pinned_emp_ids`, `alloc_<allocation id>` (the **full uploaded worklist rows** for each allocation).

**RPC functions** (in `multi_company_setup.sql`): `owner_login`, `owner_change_password`, `create_company`, `update_company`, `delete_company`, `sync_company_tables`, plus internal `_is_owner`, `_clone_table` and the `_home_tables` view.

**Storage:** bucket `feed-media` (public); added companies get their own folder.

## 5. Auth and roles

- **Sign-in:** company name/code → Employee ID + password. The password is compared **in the browser** against `users.password` (plain text). The user object is kept in `sessionStorage` (`hh_user`).
- **Roles** (`users.role`): `employee`, `supervisor`, `manager`, `admin`.
  - `admin` and `manager` both get the full admin app (including Settings and Team). A manager's data is scoped to `supervised_projects` (`['ALL']` or empty = everything).
  - `supervisor`: admin monitoring pages scoped to `supervisor_ids` + `supervised_processes`; per-person `permissions` (`resetPassword`, `bypassDeadline`, `editCounts`, `editQuality`, `pinEmployee`, all default **on**).
  - `employee`: own work only.
  - **Helix Hub owner** (`helix_owners`): checked server-side by RPC; can open any company as `admin` (`isOwner: true`).
- **Process access:** `users.access` / `processes`, with values MCO, MCD, MCR, AUTH, ALL for the home company.
- **Access control is enforced only in the UI.** There is no Supabase Auth and no row-level security on the data tables. Anyone with the anon key (it ships in the browser bundle) can read or write any table, including `users.password`. The README already flags this.
- **Default admin seeding:** if `users` is empty, `Login.jsx` creates `ADMIN` / `Admin@123`.
- **Audit:** `logAudit()` records edit_counts, edit_hourly_counts, edit_quality, quality_bypass/remove, remove_bypass, pin/unpin, assign_team and reset_password. It does **not** record logins, user create/delete, settings changes, allocations, announcements or company actions.

## 6. Half-built, inconsistent or risky

**Half-built / orphaned**
1. **Audit log has no viewer.** It is written but no page reads it.
2. **`call_logs` table is orphaned.** EmpDetail can delete from it, but nothing writes it. Calls are stored on `daily_logs.calls` instead.
3. **Password reset flow is incomplete.** Admins and supervisors can approve `reset_requests`, but nothing creates one. "Forgot password" only says "contact your administrator".
4. **Keka import uses placeholder rules.** `LATE_LOGIN_THRESHOLD` and `BREAK_LIMIT_MINUTES` are marked "placeholders until real Keka export columns/rules are confirmed".
5. **Changelog is only reachable from the Owner Console.** It isn't in any company's navigation.
6. **No "clients" master.** "Client" exists only as the project name on `processes` (e.g. `PMB`). There are no `clients` or `payers` tables (roadmap 0.5 / Phase 1).
7. **No database schema in the repo** for the core tables. Only the multi-company SQL exists, so new migrations have no baseline to build on.
8. ~~No `docs/` roadmap.~~ Fixed: the roadmap was moved from `dist/` to `docs/HELIX_ROADMAP.md`.

**Inconsistencies**
9. **CLAUDE.md was wrong about the stack** (now corrected). It said Next.js; this is a Vite SPA with no server. That matters for the HIPAA rules ("runs on our own server", PDF → Excel on server in 2.4, AI calls). There is currently no server to run anything on.
10. **`VITE_ANTHROPIC_KEY` holds the Supabase anon key.** `callAI()` also falls back to it as an Anthropic key. That fallback can never work, and the naming is misleading.
11. **The AI model is hardcoded** (`claude-opus-4-5`) and called straight from the browser with the admin-saved key (`anthropic-dangerous-direct-browser-access`). Any signed-in user can read the key from `rcm_store`.

**Security / HIPAA concerns to resolve before adding Workbench modules**
12. Plain-text passwords, client-side login, no RLS (see section 5).
13. **Work Allocation uploads** (aging/claim worklists, which likely include patient names, member IDs and DOS) are saved whole into `rcm_store` (`alloc_<id>`). They are readable by anyone with the anon key. This is the main PHI exposure today.
14. The Giphy API key is hardcoded in `constants.js`.
15. `feed-media` uses public URLs. Fine for social posts, **not** suitable for the payer forms, appeal packets or SOP screenshots planned in later phases.
16. AI emails send employee names and metrics only, no patient data (OK under the PHI rule).

## 7. What this means for the roadmap

- 0.2 Workbench nav: add tab entries with `section: 'Workbench'` to `ADMIN_TABS` / `SUPERVISOR_TABS` / `empTabs` and cases in the three `*App.jsx` routers. No router to change.
- 0.3 Roles: the roadmap's roles (Team Lead, AR, Auth, Billing/Posting, Coding, Credentialing, QA) don't map onto the current `role` values (employee/supervisor/manager/admin). Team membership today comes from `processes`/`access`, not `role`. You need to decide whether these become roles or team/process tags.
- 0.4 Audit log: the table and `logAudit()` already exist. This step becomes "extend + add a viewer + cover more actions".
- 0.5 / Phase 1+: new tables need a migrations folder. Every company picks them up via **Sync structure** in the Owner Console.
- Anything needing "our own server" (2.4, 5.3, 8.1, 9.x) first needs a server piece (e.g. Supabase Edge Functions or Vercel functions).
