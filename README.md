# Helix Hub

RCM team performance portal. Each company gets **its own copy** of Helix Hub with its
**own Supabase database**, so company data never mixes.

## Setting up Helix Hub for a new company

1. Create a new Supabase project for the company (same `rcm` schema and tables as the
   existing one) and a new deployment of this repo.
2. Set the deployment's environment variables:

   | Variable | Example | Purpose |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://xyz.supabase.co` | The company's own database |
   | `VITE_ANTHROPIC_KEY` | — | Supabase anon key (existing variable name) |
   | `VITE_COMPANY_NAME` | `Acme Health` | Company name users type on the first login screen |
   | `VITE_COMPANY_CODE` | `ACME` | Optional short code also accepted on that screen |

3. Sign in: type the company name (or code) → then `ADMIN` / `Admin@123`
   (created automatically on an empty database). **Change this password right away.**
4. An admin can rename the company any time in **Settings → Company**; that saved
   value overrides the environment variables.

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
