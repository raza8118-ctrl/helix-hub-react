# Helix Hub

RCM team performance portal. Users sign in in two steps: **company name** (or code), then
**Employee ID + password**.

## Multiple companies in one installation

Companies are managed only by the **Helix Hub owner** from the **Owner Console**, a
separate login that no company admin (including the home company's) has. Each company
gets its own copy of every table, named `co_<code>__<table>` (e.g. `co_acme__daily_logs`).
Its users, task targets, processes, holidays, quality rules, reports, settings and AI key
are completely separate, so productivity calculations never mix. The interface is
identical for every company.

**One-time setup:** open Supabase → SQL Editor, paste `supabase/multi_company_setup.sql`,
and click Run. Then create your owner login (choose your own password):

```sql
insert into rcm.helix_owners (username, name, password)
values ('OWNER', 'Your Name', 'your-password-here');
```

After that:

1. On the login screen click **Helix Hub owner sign in** and sign in with that login.
2. **Owner Console → Add a company**: enter a name, short code, and the first admin's
   ID and password. The console also renames, activates/deactivates and deletes companies,
   renames the home company, and **Open →** signs you in to any company with full admin
   access (a purple banner takes you back to the console).
3. That company's users sign in with the company name or code, then their own login.
4. **After any Helix Hub update that adds tables or columns**, click **↻ Sync structure**
   in the Owner Console so every company gets them.

> Separation is enforced by the app, not by database security rules. That's the same
> trust level as before (the public API key can read any table, including plain-text
> passwords). Before onboarding external paying clients, move to Supabase Auth with
> row-level security.

## Setting up a separate deployment for a company (alternative)

1. Create a new Supabase project for the company (same `rcm` schema and tables as the
   existing one) and a new deployment of this repo.
2. Set the deployment's environment variables:

   | Variable | Example | Purpose |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://xyz.supabase.co` | The company's own database |
   | `VITE_SUPABASE_ANON_KEY` | — | The database's anon (public) key |
   | `VITE_ANTHROPIC_KEY` | — | **Old name** for the same Supabase anon key — still read if `VITE_SUPABASE_ANON_KEY` isn't set; remove once the new name is in place. It is *not* an AI key: the AI key is saved in **Settings** |
   | `VITE_COMPANY_NAME` | `Acme Health` | Company name users type on the first login screen |
   | `VITE_COMPANY_CODE` | `ACME` | Optional short code also accepted on that screen |

3. Sign in: type the company name (or code) → then `ADMIN` / `Admin@123`
   (created automatically on an empty database). **Change this password right away.**
4. The Helix Hub owner can rename the company in the **Owner Console**; that saved value
   overrides the environment variables.

Without any company settings, the installation defaults to **3Gen Consulting** (code `3GEN`).

---

## React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
