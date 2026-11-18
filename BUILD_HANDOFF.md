# Slotly Build Handoff — 18 November 2026

> Use this document when continuing the browser QA and accessibility work.

## Current stop point

The build stopped after the full local browser QA pass over the wired client. Every flow that
has a Worker endpoint was driven in a real headless Chrome against a local Worker (`wrangler
dev` on 8787) and Vite (5173) with local D1 seeded.

This work is committed (`cf57a3d Harden live client flows after browser QA`), pushed to
`origin/main`, and deployed. `npm run typecheck`, `npm test` (159 tests in 17 files) and
`npm run build` pass, the signed-out page audit passes 33/33 route-width checks, and the flow
and account suites pass with 0 failures.

## Verified in this session

- Ran the resume protocol: typecheck, 157-test baseline, build — all green before any edits.
- Started local `wrangler dev` plus Vite so the browser exercised the real Worker and local D1,
  not the deployed app or mock data.
- Added a dependency-free Chrome DevTools Protocol harness (`scripts/ui-qa/`, Node 22+
  built-in `WebSocket`, no Playwright/Puppeteer) and committed it with npm scripts and docs.
- Guest booking → request received → private cancellation page: `noindex, nofollow` and
  `no-referrer` meta, explicit POST cancellation, single-use link, generic unavailable state.
- Customer sign-in, signed-in booking without guest fields, history, detail and cancel dialog.
- Staff dashboard/queue/detail: decline with a reason, approve, dialog keyboard containment.
- Admin dashboard/queue/detail: reschedule and reassignment controls, cancel dialog, service
  form labelling; responsive checks at 390/768/1440 on all staff/admin pages.
- Staff availability: time off overlapping a confirmed booking is blocked and lists the
  affected `SLO-...` reference; free time off adds and removes; weekly hours render.
- Voluntary password change and the forced first-login password change (flag cleared, session
  preserved).
- Signed-out audit of 11 routes at 390/768/1440: one `h1` per page, no duplicate ids, all
  fields labelled, no unnamed controls, no heading jumps, no horizontal overflow, no
  unexpected console/network errors.

## Defects found and fixed

1. **`Dialog` did not contain keyboard focus.** Tab moved through the nav and page behind the
   backdrop. It now traps Tab/Shift+Tab, focuses the first control, restores the previously
   focused element, labels its title with `useId`, and scrolls inside the viewport
   (`max-height` + `overflow-y` in `base.css`).
2. **State-only screens had no `h1`.** `StateBlock` now takes `headingLevel` (default 2), and
   page-level states pass `headingLevel={1}`. Skeleton-only loading branches keep a heading too.
3. **Password change logged the user out.** The Worker returns `204` and keeps the session, but
   the client typed the response as `AuthUser`, published `undefined` and redirected to
   `/signin`. It now refreshes `/api/auth/me`; regression test in `tests/client/session.test.ts`
   (new `tsconfig.client-test.json` project, because these tests import DOM-targeted `src/`).
4. **No route to the password page.** Signed-in site nav and both workspace sidebars now link
   to `/change-password`.
5. **Missing favicon.** Added `public/favicon.svg` and the `<link rel="icon">`.

## Cut off / known incomplete areas

1. **Reports UI**: `/api/admin/reports/summary` and `export.csv` are implemented and tested but
   have no client screen.
2. **Admin staff management**: creating staff, issuing another temporary password and
   deactivating staff have APIs/middleware rules but no UI.
3. **Business settings UI**: no screen for name, timezone or booking window.
4. **Email**: delivery stays disabled until a verified Resend sender and key exist. No client
   work is required for this.
5. **Contrast/axe pass**: the harness checks structure, focus, overflow and control names; there
   is no automated contrast or axe run yet (token pairs were spot-checked by hand and pass AA
   for body text, status tags and workspace nav).

## Exact acceptance checks run

- `npm run typecheck` — passed.
- `npm test` — 159 tests across 17 files passed.
- `npm run build` — passed; Vite built `dist`.
- `npm run qa:ui:audit` — 33/33 page-width checks passed, 0 failures.
- `npm run qa:ui:flows` — 0 failures (guest, cancellation, customer, staff, admin, responsive).
- `npm run qa:ui:accounts` — 0 failures (availability conflict, time off add/remove, voluntary
  and forced password change).
- Local D1 QA accounts removed with `npm run qa:ui:cleanup`; only the seed accounts remain.

## Resume protocol

1. Run `npm run typecheck`, `npm test`, `npm run build`.
2. Start `npm run dev:worker` and `npm run dev`, confirm local D1 is migrated and seeded, then
   run `npm run qa:ui:audit` and `npm run qa:ui:flows` for a regression baseline.
3. Next product work: the admin reports summary/CSV screen, then admin staff management, then
   business settings. Keep the report APIs as the source of truth and do not invent metrics.
4. Do not begin email configuration until a verified Resend sender exists.
5. The live bundle now includes the client wiring and QA fixes. Re-run the acceptance checks
   before any further deploy, and do not deploy without explicit owner approval.

## Deployment state

- Deployed URL: `https://slotly.marcoeduardo-asegurado.workers.dev`
- Deployed version ID: `21f174ab-231c-4384-9fcd-19ec0ac8dd10` (commit `cf57a3d`), deployed
  18 November 2026. It includes the wired client and the QA fixes above.
- Post-deploy smoke checks (read-only, no production writes): `/api/health` 200 `ok`;
  `/api/public/business` returns `Slotly Studio` / `Asia/Manila` / 60-day window;
  `/api/public/services` 200 with 4 services; `/` 200 serving the new `index-DKcxSvyr.js`
  bundle with the favicon link; `/favicon.svg` 200 `image/svg+xml`; unauthenticated
  `/api/admin/dashboard` returns 401.
- No migration was required or applied for this deploy, and no remote D1 rows were written.
- Email delivery remains disabled (`EMAIL_TRANSPORT=none`) until a verified Resend sender and
  key exist.
- Production data was not reset.
- `.local-secrets/` remains gitignored and must not be committed or printed.

## Repository safety

- Do not commit `.local-secrets/`, credentials, session data, or generated SQL with passwords.
- `qa-artifacts/` (screenshots and logs from the harness) is gitignored.
- Browser QA writes real rows to local D1 only; reseed with `npm run db:seed:local` for a clean
  demo dataset. `npm run qa:ui:cleanup` removes QA-only accounts.
- Keep remote D1 writes explicit and scoped. No further migration or reset is implicit.
