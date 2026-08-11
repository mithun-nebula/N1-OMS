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

The spine's record store, activity log and figure store are **async**
(`Promise`-returning) so a durable backend can drop in behind the same
interfaces. The **gate stays synchronous** — only store I/O is awaited. See
**Status → Persistence** below.

## Project layout

```
src/
  spine/        load-bearing core (framework — no domain specifics)
    operation/  Operation {name,args,startedBy,authority,runsUnder} + registry
    permission/ role × record × field (appendix C); export ≠ view
    gate/       six checks as an ordered pipeline; refusal is opaque; stays SYNC
    activity-log/ append-only; who / authority / changes / undo  (async interface)
    record/     connected-record node+edge graph; cross-record traverse()  (async interface)
    figures/    every figure keeps the parts it was computed from  (async interface)
    adapters/   the seven starts → one Operation (voice stubbed)
    spine.ts    facade: submit → gate → execute → record → publish  (async)
  domains/      per-phase operations, figures & seed data (all execute handlers async)
    people/     Phase 2 — leave.request/approve/decline, joining, leaving, n1-doctypes registry
    course/     Phase 3 — course.updateStage, completion figure, versioning
    workplace/  Phase 4 — rooms, meetings, open calendar (appendix E), events, equipment, documents, announcements
    assistant/  Phase 5 — coordinator + specialists + daily flow
    autonomy/   Phase 6 — standing rules, earning-the-right (AutonomyLedger stays SYNC)
    shared/     cross-domain demo roster
  server/       composition root
    bootstrap.ts      builds the world (stores + policy + registers all domains); seed guard
    runtime.ts        process-singleton world (async getWorld/getSpine) for the API routes
    policy.ts         demo permission rules + DemoRoleProvider + n1GeneratedRules()
    store-pg-record.ts    PostgresRecordStore (durable, when DATABASE_URL set)
    store-pg-activity.ts  PostgresActivityLog (durable)
    store-pg-figures.ts   PostgresFigureStore (durable)
    store-pg.test.ts      durability integration tests (skip without DATABASE_URL)
    n1-readthrough.ts generic N1 read-through for any mapped DocType
    auth.ts           RBAC: session tokens, password hashing, getSessionUser
    auth-constants.ts edge-safe cookie name (importable from middleware)
    accounts.ts       demo credential store + verifyCredentials + change/reset password
  config/       provider-agnostic stubs + typed clients — decisions open
    providers.ts     env-swappable LLM/Video/N1 factories (stubs now)
    n1-client.ts N1 REST client (service-account auth, retry)
    env.ts           typed env config (DATABASE_URL / N1_* / provider selection)
  app/          Next.js App Router — thin API routes + web UI (login + ~20 pages)
  middleware.ts guards routes by session cookie (Edge runtime — no node:crypto)
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
- `POST /api/operations` — body `{ start, name, args, ruleId+ruleAuthor? }` (person-starts use the signed-in actor). Includes generic `record.create` / `record.update` / `record.delete` for any DocType.
- `POST /api/operations/[id]/confirm` — confirmed by the signed-in user
- `GET  /api/records/[type]/[id]` — read-through with field permission (actor = session)
- `GET  /api/records-list?type=` — list any N1 DocType (permission-filtered, read-through)
- `GET  /api/n1-doctypes` — N1 DocType catalog (categories + node types + sensitivity)
- `GET  /api/figures/[type]/[id]` — figure + computed-from breakdown
- `GET  /api/activity?operation=&actor=&nodeType=&nodeId=&limit=`
- `POST /api/activity/[id]/undo` — undo an action by activity entry id
- `GET  /api/notifications` · `GET /api/search` · `GET /api/export?type=` (gated by `canExport`)

## Non-negotiables enforced here (CONTEXT §13)

1. One gate; permission + activity log live only there.
2. Refusal never discloses a record's existence.
3. Money/people + leaving-org never go automatic (need confirmation).
4. Autonomy is earned (stubbed supervised policy now; real logic in Phase 6).
5. Exporting ≠ viewing.
6. Any figure opens into the parts it was computed from.

## Status

The spine's record store, activity log and figure store are **async** interfaces
(`Promise`-returning) so a durable backend can drop in. The gate itself stays
synchronous; only store I/O is awaited. The `AutonomyLedger` stays in-memory
sync (it's consumed synchronously by the gate's autonomy policy).

**Persistence (Postgres):** set `DATABASE_URL` and the spine uses six Postgres-backed
stores (`src/server/store-pg-*.ts` + `accounts.ts` + `AutonomyStore`): `orga_nodes`,
`orga_edges`, `orga_activity`, `orga_figures`, `orga_accounts`, `orga_autonomy_rules`
— every record, relationship, activity entry, figure, credential and graduation state
persists across restarts. Unset → async in-memory (resets on restart). A **seed
guard** seeds demo data only on a first/empty run; the `owners`/`teams` permission maps
are hydrated from `DEMO_PEOPLE` + course nodes on boot so team/ownership scopes work
after restart. Integration tests in `src/server/store-pg.test.ts` run only with
`DATABASE_URL` (`npm run test:db`).

Cloud infra (Phase 0) and N1 integration (Phase 2) are next; both are abstracted
behind the same interfaces.

**N1 DocType mapping:** 150 of 161 N1 DocTypes are mapped via a registry
(`src/domains/people/n1-doctypes.ts`) — nodeType + category + sensitivity per
DocType, generic snake→camel field mapping, auto-generated permission rules
(`n1GeneratedRules()` in `policy.ts`: sensitive = HR/admin view+export; else
all-roles view, HR/admin edit), and read-through via
`src/server/n1-readthrough.ts` (`N1ReadThroughService`, live when
`n1Mode() === "live"`). Browsable at `/records` (catalog `/api/n1-doctypes`,
list `/api/records-list?type=`); dedicated pages for `/payroll` + `/expenses`. The
`/records` page is a **full CRUD manager** — `record.create` / `record.update` /
`record.delete` operations (through the gate, audited, undoable) let HR/admin
edit any DocType record, create new ones, delete (admin), and export CSV.
Demo seed data in `src/domains/people/n1-demo-seed.ts` covers all 150 DocTypes
with category-aware realistic records (per-type idempotent gap-fill on boot).

**Roadmap — team workflow (planned, not yet built):**
`/standup` (3-line daily check-in), task deadlines on `/calendar`, deadline
reminders (auto-notify via PublishBus), team/role task assignment (resolve
"course team" → individuals), team workload view on `/team`, and `/today`
(restore appendix-A morning-brief → day-plan → streak; the engine is built +
async-tested, needs the UI). See `docs/TODO.md` § "Roadmap — Team workflow
features" for details.
