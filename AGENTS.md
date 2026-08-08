# AGENTS.md — Organization A spine

## Commands

- `npm run dev` — Next.js dev server (App Router, Turbopack).
- `npm run build` — production build.
- `npm run lint` — ESLint (flat config).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest run; `npm run test:watch` for watch mode.

Run `npm run lint && npm run typecheck && npm test` before declaring a task done.

## What this is

The **Phase 1 spine** of the application described in `docs/CONTEXT.md` /
`docs/BUILD-PLAN.md`: every action is an **Operation** that funnels through
**one Gate**, is **recorded**, and is **published**. This is the load-bearing
foundation (Phase 1); do not start later phases until the gate, activity log and
permission layer are solid.

## Project layout

```
src/
  spine/        load-bearing core (framework — no domain specifics)
    operation/  Operation {name,args,startedBy,authority,runsUnder} + registry
    permission/ role × record × field (appendix C); export ≠ view
    gate/       six checks as an ordered pipeline; refusal is opaque
    activity-log/ append-only; who / authority / changes / undo
    record/     connected-record node+edge graph; cross-record traverse()
    figures/    every figure keeps the parts it was computed from
    adapters/   the seven starts → one Operation (voice stubbed)
    spine.ts    facade: submit → gate → execute → record → publish
  domains/      per-phase operations, figures & seed data
    people/     Phase 2 — leave.request, employee directory
    course/     Phase 3 — course.updateStage, completion figure
    workplace/  Phase 4 — rooms, meetings, open calendar (appendix E), events, equipment, documents, announcements
    assistant/  Phase 5 — coordinator + specialists + daily flow
    autonomy/   Phase 6 — standing rules, earning-the-right
    shared/     cross-domain demo roster
  server/       composition root
    bootstrap.ts      builds the world (stores + policy + registers all domains)
    runtime.ts        process-singleton world for the Next.js API routes
    policy.ts         demo permission rules + DemoRoleProvider
    auth.ts           RBAC: session tokens, password hashing, getSessionUser
    auth-constants.ts edge-safe cookie name (importable from middleware)
    accounts.ts       demo credential store + verifyCredentials
  config/       provider-agnostic stubs + typed clients — decisions open
    providers.ts     env-swappable LLM/Video/N1 factories (stubs now)
    n1-client.ts N1 REST client (service-account auth, retry)
    env.ts           typed env config
  app/          Next.js App Router — thin API routes + web UI (login, today)
  middleware.ts guards routes by session cookie (Edge runtime — no node:crypto)
vendor/         vendored OSS (git submodules)
  n1/    N1 = our HR/payroll backend (upstream frappe/hrms, version-16) — headless, REST-only
apps/           our own code
  n1-custom/ N1 customization layer (custom fields/fixtures on top of frappe+hrms)
docs/           spec, research, mock UIs (CONTEXT.md, BUILD-PLAN.md, …)
```

## Roles & auth (RBAC)

Six roles, applied by the gate's permission layer (role × record × field):

| Role | Can |
|---|---|
| `super-admin` | Everything on managed records, incl. delete + system config |
| `admin` | All record actions except delete (reserved for super-admin) |
| `hr` | People/payroll: view/edit/approve/export employee (pay visible) |
| `manager` | Own team: approve leave; courses org-wide |
| `employee` | Self leave edits; team directory (pay 🔒); write team courses |
| `intern` | Read-only: team directory (pay 🔒); view team courses |

- Demo logins (one per role): quick-login grid on `/login` —
  `superadmin/super123` · `admin/admin123` · `hr/hr123` ·
  `manager/manager123` · `employee/employee123` · `intern/intern123`.
  (Each maps to a real demo person underneath: hr→Shruti, manager→James,
  employee→Priya, intern→Ravi.)
- `finance` is folded into `admin` for now; add as a 7th role if separation of
  duties is needed.
- Auth is local (scrypt-hashed demo passwords + HMAC-signed session cookie) and
  abstracted behind `verifyCredentials` / `getSessionUser`. Supabase Auth
  (BUILD-PLAN Phase 0) drops in by swapping that module — the gate is unchanged.
- The signed-in actor is the authority for all person-started operations via the
  API; app-starts (schedule/standing-rule/…) take a `ruleAuthor` in the body and
  in production come from Cloud Run Jobs with a service account.

## API (App Router, `src/app/api/`)

- `GET  /api/health` (public — Cloud Monitoring uptime checks)
- `POST /api/auth/login` — `{ username, password }` → sets session cookie
- `POST /api/auth/logout`
- `GET  /api/me` — current session user
- `POST /api/operations` — body `{ start, name, args, ruleId+ruleAuthor? }` (person-starts use the signed-in actor)
- `POST /api/operations/[id]/confirm` — confirmed by the signed-in user
- `GET  /api/records/[type]/[id]` — read-through with field permission (actor = session)
- `GET  /api/figures/[type]/[id]` — figure + computed-from breakdown
- `GET  /api/activity?operation=&actor=&nodeType=&nodeId=&limit=`

## Non-negotiables enforced here (CONTEXT §13)

1. One gate; permission + activity log live only there.
2. Refusal never discloses a record's existence.
3. Money/people + leaving-org never go automatic (need confirmation).
4. Autonomy is earned (stubbed supervised policy now; real logic in Phase 6).
5. Exporting ≠ viewing.
6. Any figure opens into the parts it was computed from.

## Status

Phase 1 complete (in-memory). Cloud infra (Phase 0) and N1 integration
(Phase 2) are next; both are abstracted behind the `RecordStore` / `ActivityLog` /
`FigureStore` interfaces so a Supabase/N1-backed implementation drops in
without touching the gate or the API.
