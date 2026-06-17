---
name: Classificados Jaragua stack
description: Key decisions, gotchas, and sync points for this project
---

## Stack
- Plain `http` module + `pg` + `mercadopago` (v3). No framework.
- Single HTML SPA at `public/index.html` (~1970 lines).
- PostgreSQL via `DATABASE_URL`. Tables: `ads`, `users`.

## City list — must stay in sync
Two places declare ALLOWED_CITIES:
1. `server.js` line ~11: `const ALLOWED_CITIES = [...]`
2. `public/index.html` JS section: `const ALLOWED_CITIES = [...]`
Current list: Jaraguá do Sul, Guaramirim, Schroeder, Massaranduba, Corupá

## Mercado Pago payment flow
- Endpoint: `POST /api/payment/create-preference`  
- Requires env secret `MP_ACCESS_TOKEN` (set in Replit Secrets)
- Returns `{ ok, init_point, sandbox_init_point }`
- Frontend `startPayment(plan, title, price)` calls endpoint then opens init_point in new tab
- Uses mercadopago v3 SDK: `MercadoPagoConfig` + `Preference`

## Google Sign-In 403 errors
Known issue: GSI logs "origin not allowed" because the Replit `.replit.dev` domain must be added to GCP Console → Credentials → OAuth Client → Authorized JavaScript Origins.

## Session persistence pattern
- `currentUser` + `userToken` stored in localStorage
- `updateUserUI()` manages both topbar (#topbarUserArea) and header (#headerLoginBtn)
- `requireLogin(callback)` stores pending action in `_pendingAction`, then `handleGoogleCredentialWithRedirect` executes it after login

## package-lock.json
Must be regenerated with `npm install --registry https://registry.npmjs.org` before Vercel deploy. Never leave Replit-internal registry URLs in lock file.
