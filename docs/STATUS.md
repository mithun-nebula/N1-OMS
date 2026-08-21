# Project Status — N1-OMS

> Last updated: 2026-08-19
> Repo: https://github.com/mithun-nebula/N1-OMS
> Branch: `main`

## Phase progress

| Phase | Items | Done | Status |
|---|---|---|---|
| **1** Spine (Operations, Gate, Record) | 18 | **18** | ✅ complete |
| **0** GCP serverless infra & skeleton | 22 | 6 | local skeleton done; GCP excluded |
| **2** People & HR | 15 | **14** | core complete; GCP-verify remains |
| **3** Course work domain | 11 | **10** | pipeline complete; docx/PDF renderer deferred |
| **4** Workplace domain | 25 | **25** | ✅ complete |
| **5** Assistant & daily flow | 25 | **25** | ✅ complete |
| **6** Autonomy engine | 14 | **14** | ✅ complete |
| **7** Voice, web surfaces & polish | 16 | **16** | ✅ complete |
| **8** Hardening, compliance & deploy | 14 | 0 | GCP deploy/monitoring/backups — not started |
| **Total** | **160** | **128** | **80%** |

## What works right now

Run `npm run dev` → http://localhost:3000 → redirects to `/login`.

### Demo logins (one per role)

| Login | Password | Role | Person |
|---|---|---|---|
| `superadmin` | `super123` | super-admin | Super Admin |
| `admin` | `admin123` | admin | Administrator |
| `hr` | `hr123` | hr | Shruti |
| `manager` | `manager123` | manager | James D. |
| `employee` | `employee123` | employee | Priya R. |
| `intern` | `intern123` | intern | Ravi |

### Screens

- `/dashboard` — stat cards (click-through), my tasks (quick-complete checkbox), upcoming meetings, role-aware pending-approvals (approve inline), HR/admin attention cards
- `/tasks` — kanban (To Do / In Progress / Done). **Top-down RBAC (2026-08-19):** manager+ create/assign/edit, employees update status of their own only, delete admin-level; each role sees its own board (employee: own · manager: team · hr/admin: all); course-linked tasks carry a course chip
- `/meetings` — create (online/in-person/both), edit (preserves link), cancel, add attendee (auto-sends link)
- `/booking` — room booking with clash sorting
- `/courses` — 4-column kanban, move stages (valid transitions only), module-state editing, version history + restore, progress notes, stage-owner assignment
- `/calendar` — month grid, create/edit/cancel entries, add/remove people (by name or description), undo toast, clash preview
- `/team` — directory (Name · Role · Contact · Pay 🔒 Restricted), clickable per-person detail (courses/tasks/leave), "Building now", export CSV
- `/leave` — request form (dates/type/reason), balance, pending approvals (approve/decline-with-reason), clash flags, history
- `/me` — own record, leave balance + history, attendance, inline contact editing (payslips omitted for now)
- `/documents` — document register, version history, required-vs-supplied, expiring-soon, role-access
- `/messages` — chat: one-to-one + Everyone group, no RBAC, unread badges (replaced announcements 2026-08; `/announcements` redirects)
- `/events` — create/register/add-tasks/close-with-report, overdue + pacing detection
- `/equipment` — register, fault reporting (voice-ready), repeat-fault detection, fault history
- `/utilities` — short-question capture with 2/day limit indicator + historical view
- `/decisions` — browse/search org-memory, record decisions with reason
- `/hr` — HR-only joining (start/complete steps/overdue chase) + leaving (start/handover/apply separation)
- `/settings` — edit contact, change password, theme + notification preferences
- `/records` — N1 DocType manager (all 150 mapped types): browse, **edit, create, delete, export CSV** — permission-filtered, category-grouped, through the gate with audit + undo
- `/payroll` — HR/admin salary structures + income-tax slabs (payslips omitted for now)
- `/expenses` — expense claims, travel requests, advances (N1 expense/travel group)
- `/admin` — users (create/role/reset password), autonomy rules, activity-log viewer, system status

Sidebar also has: global search, notifications bell, dark-mode toggle. Mobile gets a bottom nav.

### Planned features (team workflow — 2026-08-10)

| Feature | Description | Effort | Status |
|---|---|---|---|
| `/standup` | Team daily 3-line check-in (yesterday / today / blockers), manager sees full team grid | ~1 hr | Planned |
| Calendar deadlines | Task due dates shown as amber markers on `/calendar` month grid | ~30 min | Planned |
| Deadline reminders | Auto-notify assignee + lead when a task is due within 24h (uses PublishBus) | ~30 min | Planned |
| Team/role assignment | Assign tasks to "Course Team" / "Ops Team" / "Everyone" (resolves to individuals) | ~1 hr | Planned |
| Team workload | Per-person open-task count + meeting hours on `/team` | ~45 min | Planned |
| Morning flow (appendix A) | Chat-first brief → plan your day (mandatory time-per-item) → streak rings | — | ✅ Done — lives on `/dashboard` over `/api/today`. There is no `/today` page; it was removed. |

### Audit round (2026-08-19) — what the first pass got wrong

The six groups below were reported complete on static checks alone. An
independent audit found 4 critical and 6 high defects, and the application had
never actually been run. All are now fixed and verified against a real Postgres
and a running server.

| Was wrong | Now |
|---|---|
| **`npm run test:db` would have destroyed the live database.** It sourced `.env`, `afterEach` issued unscoped `DELETE FROM` on five tables, and the accounts test ran `DROP TABLE orga_accounts`. | Reads `ORG_TEST_DATABASE_URL`, refuses if it equals `DATABASE_URL`, deletes only `pgtest`-prefixed rows, and gates the destructive tests behind `ORG_TEST_DB_DESTRUCTIVE=1`. See AGENTS.md. |
| The durable question allowance was **write-only** — `load()` existed and nothing called it, so a restart still reset everyone. | Hydration moved *inside* `configureQuestionLimiter`, so a durable-but-unhydrated limiter is unrepresentable. |
| `answerBrief` on a committed day silently reverted `phase` from `planned` to `planning`. | Guarded, and refused with a 422. Adding and reordering stay open, per A9/A1b. |
| `commitPlan` and `finalizeDay` were non-idempotent — the streak could be inflated by re-posting. | Idempotent. `lastAssessedDate` finally does the job it was written for. |
| `managerView` stripped `miss` but still returned `actualMinutes` and `doneAt` — the ran-over miss A8 forbids, one subtraction away. | Whitelist of four fields. The test asserts the whole key set. |
| `estimateHints` was structurally always empty: learning needed a miss reason, and the hint filtered out done tasks — which is every task it could learn from. | Learns at tick time; the hint no longer excludes them. Verified end to end. |
| The whole day flow ran on **UTC**. Work scheduled at 09:00Z showed as 2:30 PM, and the app served yesterday's plan until 05:30 local. | `day-plan/time.ts` owns "today" and the 09:00 opening, in local time. `iso.slice(0,10)` removed everywhere. |
| Three of five `course.*` writes, including `restoreVersion`, had no undo plan. | Fixed, plus a **ratchet** in `conformance.test.ts`: any operation offering an undo without a serialisable plan now fails the build unless it is on an explicit, shrink-only list. |
| `/api/today/history` and `{action:"abandon"}` had no callers — the same defect the round set out to remove. | History strip under the streak rings; abandonment reported on tab-hide via `sendBeacon`, which makes A9's resume branch reachable at last. |

Also fixed: legacy plans (`autoScheduled === undefined`) were never scheduled, so the fix missed all existing data · `restOfDayAtRisk` swung from never firing to always firing · timestamps compared as strings across three different formats · duplicate "add to today" · `setProgressNote`'s undo plan serialised to `{}` on a first note.

**Verified** against Postgres 16 in Docker (21 DB tests, first execution of that SQL ever) and a running server: brief → plan → commit → tick → miss reason → meeting displacement → close-out → **restart** → team view → history. The day, streak, estimates, notifications and question allowance all survive a restart.

### Recently built (2026-08-18) — the productivity path

Six groups of repair across the day plan, before any agent work begins. See
`docs/AGENTS.md` conventions; every item below has tests.

| Area | What changed |
|---|---|
| **The loop** | Work is now placed in the day around meetings, so interrupted-vs-ran-over can actually be told apart (`classifyMiss` previously only ever returned `ran-over`). `assessDay` no longer counts interrupted work against the day. `restOfDayAtRisk` was unsatisfiable, so the overrun offer never appeared — fixed. Learned estimates are returned and applied instead of dropped. `require()` no longer calls `startDay` without awaiting it. Unfinished work carries into tomorrow's brief. Brief replies ("Handle"/"Later") now feed the plan instead of being discarded. |
| **Undo** | `undo.plan` added to all six `task.*`, both `attendance.*`, and the two course progress verbs — undo survives a restart there now, per `AGENTS.md`. `task.create` and `task.assign` previously had no undo at all. |
| **Appendix A wiring** | `arriveDuringDay`, `markLeave`, `abandon`, `managerView` and `reorder` all had implementations and no callers. A meeting booked mid-day now displaces committed work; approved leave pauses the streak; managers get `GET /api/today/team` (A8: committed + done, never the streak or a miss reason). |
| **Durability** | `PublishBus` and the question limiter gained persistence adapters — the last two subsystems without one. Notifications carry stable ids and read state. Day plans can be read over a range (`GET /api/today/history`). |
| **Tasks ↔ plan** | The plan-tick → `task.complete` cascade moved server-side so a refusal cannot leave the two disagreeing; completing a task on `/tasks` now ticks the plan item; committing a task to today starts it; tasks carry `estimateMinutes`; `/tasks` has "add to today". |
| **Figures** | `course.updateStage` and `course.restoreVersion` now recompute the completion figure — a restore previously left the old percentage on screen. Dead `finishedWithinTime` removed; `bestClean` / `dayPlanned` surfaced. |

### Recently built (2026-08-10)

| Feature | Description | Status |
|---|---|---|
| `/records` full CRUD | Generic record create/edit/delete/export for all 150 N1 DocTypes — `record.create`, `record.update`, `record.delete` operations through the gate (audited + undoable). Edit modal, create form, CSV export, delete with undo. | ✅ Done |
| N1 demo seed (all 150) | Expanded from ~15 to all 150 DocTypes — realistic category-aware demo data (payroll amounts, applicant names, tax slabs, training events, etc.). Per-type idempotent gap-fill. | ✅ Done |
| Accounts + autonomy durability | `orga_accounts` + `orga_autonomy_rules` tables — credentials and graduation state persist across restarts. | ✅ Done |

### Voice

- Hold ✦ → speak → read-back modal → confirm or cancel ("Nothing is saved")
- Shared-room toggle: restricted info on-screen only, not read aloud
- Works in Chrome/Edge (Web Speech API)

### API

`GET /api/openapi.json` lists the HTTP surface. Note it does **not** enumerate
`/api/today`, `/api/today/team` or `/api/today/history` — the day flow is
personal planning state rather than an org record, and deliberately sits outside
the operations gate.

OpenAPI spec at `GET /api/openapi.json`. Key endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health check (public) |
| `/api/auth/login` | POST | Sign in |
| `/api/auth/logout` | POST | Sign out |
| `/api/me` | GET | Current session user |
| `/api/operations` | POST | Submit an operation (seven starts) |
| `/api/operations/{id}/confirm` | POST | Confirm a pending operation |
| `/api/records/{type}/{id}` | GET | Read-through with field permission |
| `/api/records-list` | GET | List any N1 DocType (permission-filtered, read-through) |
| `/api/n1-doctypes` | GET | N1 DocType catalog (categories + node types + sensitivity) |
| `/api/figures/{type}/{id}` | GET | Figure + computed-from breakdown |
| `/api/activity` | GET | Query the activity log |
| `/api/activity/{id}/undo` | POST | Undo an action by activity entry id |
| `/api/people/{id}` | GET | Employee directory (field-filtered) |
| `/api/people/{id}/leave-balance` | GET | Leave balance |
| `/api/people/{id}/attendance` | GET | Attendance read-through |
| `/api/courses/progress` | GET | Team course progress |
| `/api/courses/{id}` | GET | Course detail + figure |
| `/api/courses/{id}/deck` | POST | Generate deck outline (LLM seam) |
| `/api/org-memory` | GET / POST | List / record decisions |
| `/api/org-memory/{id}` | GET | Retrieve (links permission-filtered) |
| `/api/calendar/{year}/{month}` | GET | Month view |
| `/api/messages` | GET / POST | Chat state / send message, mark read |
| `/api/assistant/ask` | POST | Coordinator answer (permission-bound) |
| `/api/notifications` | GET | Notifications for the session actor |
| `/api/export` | GET | Export CSV (gated by `canExport`) |
| `/api/settings/password` | POST | Change own password |
| `/api/autonomy/tick` | POST | Background tick (Cloud Scheduler) |
| `/api/autonomy/rules` | GET / POST | Rules + suggestions / accept-revoke |
| `/api/openapi.json` | GET | This API spec |

> Removed: `/api/brief`, `/api/day`, `/api/news` (dead routes from the removed `/today` page).

## Architecture

```
src/
  spine/        load-bearing core (operation/gate/permission/record/log/figures/adapters)
  domains/      per-phase operations & seed data
    people/     Phase 2 — leave, joining, leaving, payroll
    course/     Phase 3 — pipeline, figures, versioning, org-memory
    workplace/  Phase 4 — rooms, meetings, calendar, events, equipment, documents
    assistant/  Phase 5 — coordinator, briefing, daily commitments (appendix A)
    autonomy/   Phase 6 — earning-the-right, standing rules, routine watcher
    shared/     cross-domain demo roster
  server/       composition root
    bootstrap.ts  builds the world (stores + policy + registers all domains)
    runtime.ts    process-singleton world for the Next.js API routes
    policy.ts     demo permission rules + DemoRoleProvider
    auth.ts       RBAC: session tokens, password hashing, getSessionUser
    accounts.ts   demo credential store + verifyCredentials
    limiter.ts    global 2/questions-per-day limiter
  config/       provider-agnostic stubs + typed clients
    providers.ts     env-swappable LLM/Video/N1 factories
    n1-client.ts     N1 REST client (service-account auth, retry)
    env.ts           typed env config
  app/          Next.js App Router — API routes + web UI
apps/           our own code
  n1-custom/    N1 customization layer (custom fields/fixtures on top of frappe+hrms)
docs/           spec, research, mock UIs, this status file
```

## Non-negotiables (CONTEXT §13)

> **This table was wrong.** Every one of the thirteen was marked ✅ while several
> were not enforced at all, and the shortened rule text here was weaker than
> §13 — so some ticks were earned against an easier rule than the one written
> down. Audited against the code on **2026-08-19**, and the rules are now quoted
> in full. `docs/CURRENT-UPDATES.md`'s "eight are false" was itself stale.
>
> **9 hold · 3 partial · 1 not enforced.** Anything below ✅ names the gap and
> the file. Do not plan from a tick you have not read the line beside.

| # | Rule (CONTEXT §13, in full) | | Where it stands |
|---|---|---|---|
| 1 | One gate. All seven starts funnel through it; **permission and the activity log live only there** | ⚠️ | Every *record* write goes through a handler, and the log is genuinely append-only. But account administration does not: `addAccount` / `updateRole` / `resetPassword` (`server/accounts.ts`) write outside the gate and **leave no activity entry** — nothing records that someone was granted admin. Role checks also sit in ~5 routes rather than the gate. Chat is outside by design. *Fixed this round: `/api/people/[id]/attendance` checked `employee` permission and then returned attendance unfiltered — any employee could read a colleague's whole attendance history.* |
| 2 | Refusal never discloses that a record exists | ✅ | Permission runs before validation (`gate.ts`); `forbidden` and "no such record" are the same opaque answer. Pending-confirmation ids are enumerable, but those are actions, not records. |
| 3 | Money + people + leaving-the-org never go automatic (appendix B) | ✅ | *Fixed this round.* `record.delete` declared `involvesMoneyOrPeople: () => false` and no `category`, so a graduated rule could have deleted an employee or a payslip unattended. It now uses `touchesMoneyOrPeople` like its siblings. |
| 4 | Autonomy is earned (10 clean) and **revocable in one tap**; **a rule never outlives its owner** | ⚠️ | Earned and revocable both hold. The last clause does not: `suspendAuthor` has no production callers and `leaving.applySeparation` never touches autonomy, so **separating someone leaves their graduated rules live** until an admin happens to hit `/api/autonomy/tick`. Graduation and revocation are also never logged. |
| 5 | Voice always confirms before saving; restricted info never read aloud in a shared room | ✅ | Read-back modal is the only path to save. The second clause is satisfied vacuously — there is no text-to-speech anywhere. |
| 6 | Daily commitments: conversation-first, tappable replies, mandatory time-per-item, once-a-day (A1) | ✅ | *Fixed this round.* Mandatory time and once-a-day already held; conversation-first was enforced only by the screen — `start` → `select` → `commit` committed a day with the brief untouched. `selectItem` and `commitPlan` now refuse during `briefing`. |
| 7 | Two kinds of miss — interrupted (no question, streak kept) vs ran over (one question later, streak breaks); never ask while someone is still working | ✅ | Repaired in the previous round and verified against a running server. Residual: an item simply left **unfinished** at close-out is classified as neither, so it fails the day without explanation. |
| 8 | Streaks are personal only — never shown to a manager, never compared | ✅ | `managerView` is a four-field whitelist; `/api/today/team` re-projects; `streakFor` has exactly two call sites, both self-scoped. Verified in the rendered manager page: no name, no item, no `actualMinutes`. |
| 9 | The assistant comments on work, never on the person; never compares people | ✅ | `sanitizeForAppendixD` at the one place free-form text is composed; everything else is templated about records. Thin rather than false — a 15-pattern denylist at a single call site. |
| 10 | Exporting ≠ viewing (appendix C) | ✅ | `export` is a distinct action, absent from the open-calendar bypass, checked before anything is produced. Latent: `type=task`/`course` export skips record scope — safe only because it is admin-only today. |
| 11 | The common calendar is open to everyone — safeguarded by notify + record + undo, **all three required** (E3) | ⚠️ | *Undo now survives a restart* (all five calendar handlers and all three `record.*` gained serialisable plans this round). Still open: **interns cannot write to the calendar** — `readOnlyRoles` overrides the open-node exemption, contrary to E3; `assertAtomic` is dead code, so "all three" is asserted nowhere; and the write, the log append and the notify are not in one transaction. E5's "undo offered to anyone affected" is a session-local toast for the actor only. |
| 12 | At most two questions per person per day, everywhere | ✅ | *Fixed this round.* One shared, durable budget across the day plan and `utility.capture`, hydrated at boot. The prompt previously ignored it — only *answers* were capped, so a third and fourth ask still appeared; `missOffered` now checks the remaining budget. `/utilities` also displayed a UTC-keyed allowance against local-keyed enforcement. Note there is still no question *scheduler* — nothing decides when to ask. |
| 13 | Any figure can be opened into the parts it was computed from | ❌ | The mechanism works and the route is permission-checked. The property does not hold: **one figure type exists in the whole product** (course completion), **no UI ever calls `/api/figures/…`**, and every other number on screen — streak, day tally, leave balance, the four stat tiles — is not a Figure and has no parts. The passing test only proves the store can return parts for the seeded course figure. |

## Persistence

The spine's record store, activity log and figure store are **async** so a
durable backend drops in. Set **`DATABASE_URL`** (Postgres — Supabase or any) and
`buildDemoWorld()` uses **13 Postgres-backed tables**: `orga_nodes`, `orga_edges`,
`orga_activity`, `orga_figures`, `orga_accounts`, `orga_autonomy_rules`,
`orga_day_plans`, `orga_day_streaks`, `orga_day_estimates`,
`orga_notifications`, `orga_question_budget`, `orga_messages`,
`orga_message_reads` — every
record, relationship, activity entry, figure, credential, graduation state,
day plan, streak, learned estimate, notification and question allowance
persists across restarts. Unset → async in-memory (resets on restart). A **seed
guard** seeds demo data only on a first/empty run; the `owners`/`teams` permission
maps are hydrated from `DEMO_PEOPLE` + course nodes so team scopes work post-restart.
The gate stays synchronous; only store I/O is awaited.

Business logic now has real effects: `leave.approve` decrements the employee's
leave balance by the inclusive day count (and undo restores it); decline is a
no-op on balance.

## Deferred items

| Item | Phase | Reason |
|---|---|---|
| GCP hosting (Cloud Run), Supabase Auth, Cloud Scheduler | 0 / 8 | Cloud infra — needs GCP project + billing (Postgres persistence already works against any DB) |
| Verify N1 background jobs (emails, payroll) | 2 | Needs a running N1/Frappe env |
| Real docx/PDF renderer for course decks | 3 | Needs a doc library + branding assets |
| Real Google Meet client | 4 / 7 | Needs a Google service account (GCP) |
| Real blob storage (documents) | 4 | Needs Supabase/Cloud Storage |
| OpenAPI spec generation (auto from zod) | 1 / 7 | Hand-authored spec served at /api/openapi.json; auto-gen optional |
| Cloud Run tuning, backup drills, security review | 8 | Production hardening — needs live stack |

## Commands

```bash
npm run dev          # Next.js dev server → http://localhost:3000
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest run (149 tests; +8 Postgres integration tests skip without DATABASE_URL)
npm run test:watch   # Vitest watch mode
npm run test:db      # Vitest run ONLY the Postgres durability tests (loads .env → DATABASE_URL)
```

## Environment

Copy `.env.example` to `.env`. Defaults work for local dev.
Set `N1_BASE_URL` / `N1_API_KEY` / `N1_API_SECRET` when N1 (Frappe) is live.
Set `ORG_LLM_PROVIDER=dev` for canned LLM responses (assistant/deck).
Set `DATABASE_URL` (Postgres — Supabase or any) to persist data across restarts;
unset → async in-memory (resets on restart).
