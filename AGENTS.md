# AGENTS.md — Organization A spine

## Commands

- `npm run dev` — Next.js dev server (App Router, Turbopack).
- `npm run build` — production build.
- `npm run lint` — ESLint (flat config).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest run; `npm run test:watch` for watch mode.
- `npm run test:db` — the Postgres suite. **Requires `ORG_TEST_DATABASE_URL`**;
  skips entirely without it.

Run `npm run lint && npm run typecheck && npm test` before declaring a task done.

### The database tests need a throwaway database

`src/server/store-pg.test.ts` writes and deletes rows. It reads
`ORG_TEST_DATABASE_URL` — never `DATABASE_URL` — and refuses to start if the two
are equal. This matters: the script used to source `.env`, `afterEach` issued
unscoped `DELETE FROM orga_nodes / orga_edges / orga_activity / orga_figures /
orga_autonomy_rules`, and the accounts test ran `DROP TABLE orga_accounts`. One
run against the live database would have deleted every record and destroyed
every login. Deletes are now scoped to the `pgtest` prefix, and the accounts
tests additionally require `ORG_TEST_DB_DESTRUCTIVE=1`.

One line to get a database:

```
docker run -d --name n1oms-testdb -e POSTGRES_PASSWORD=testonly \
  -e POSTGRES_DB=n1oms_test -p 55432:5432 postgres:16-alpine
```

then

```
ORG_TEST_DATABASE_URL="postgresql://postgres:testonly@127.0.0.1:55432/n1oms_test" npm run test:db
```

That container already exists on this machine — `docker start n1oms-testdb`.

### Time is local, not UTC

`src/domains/assistant/day-plan/time.ts` is the single source for "today" and
for the 09:00 the working day opens at, and both are computed in **server local
time**. Never derive a day with `iso.slice(0, 10)` — that is the UTC day, and
for an India-resident deployment it is the wrong one for five and a half hours
out of every twenty-four. Use `localDate()` / `localDateOf()`. **Deployment must
set `TZ`.**

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

## Node-id convention (required)

`PostgresRecordStore.nodeByIdAny()` resolves an id **without** a type
(`WHERE id=$1 LIMIT 1`), and `traverse()` depends on it. Two node types sharing
an id makes traversal silently return the wrong record — no error, wrong answer.

**Every new node type must use a type prefix.** Where a record belongs to one
person, put the owner in the id too: the permission layer's `ownerOf()` is
synchronous and can then parse it with no I/O, instead of hydrating a map of
every row at boot.

| Type | Id shape |
|---|---|
| `employee` | bare person id (`priya`) — **the node id IS the actor id**, relied on by `ownerOf` |
| `department` / `designation` | `dept_<slug>` / `desig_<slug>` |
| `approval` | `apr_<ulid>` |
| `attendance` / `employee-checkin` | `att_<employee>_<YYYY-MM-DD>` / `chk_<employee>_<ts>` |
| `attendance-request` / `shift-assignment` / `shift-request` | `atr_` / `sha_` / `shr_` + `<employee>_<seq>` |
| `leave-ledger-entry` / `leave-allocation` | `lle_` / `lal_` + `<employee>_<seq>` |
| `holiday-list` / `notification` | `hol_` / `ntf_` |

`src/spine/integrity.test.ts` asserts no two types share an id.

## Writing an operation (all six rules apply)

Every operation is a verb an agent may later call through a non-form start, so:

1. `category` and `involvesMoneyOrPeople` must be **exactly** right — they drive
   gate checks 4 and 5, and `NEVER_GRADUATE = {money, people, leaving-org}`. A
   mislabelled operation is a hole in the autonomy safety net. When unsure, `true`.
2. **No business logic in React components.** If a decision lives in a page, no
   agent can reach it.
3. Return a **serialisable `undo.plan`**, not only a closure — closures die with
   the process (`src/spine/spine.ts` replays the plan otherwise).
4. `validate()` returns structured `missing[]`, never prose — that array is how a
   caller knows which argument to ask for.
5. `permission()` declared per operation and scoped to the record.
6. Operations are complete units: args in, effect out, no reliance on UI state.

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
