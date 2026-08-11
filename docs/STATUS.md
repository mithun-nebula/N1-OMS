# Project Status — N1-OMS

> Last updated: 2026-08-09
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
- `/tasks` — kanban (To Do / In Progress / Done), create/complete/assign/edit/delete, filter by assignee/project/priority, overdue badges
- `/meetings` — create (online/in-person/both), edit (preserves link), cancel, add attendee (auto-sends link)
- `/booking` — room booking with clash sorting
- `/courses` — 4-column kanban, move stages (valid transitions only), module-state editing, version history + restore, progress notes, stage-owner assignment
- `/calendar` — month grid, create/edit/cancel entries, add/remove people (by name or description), undo toast, clash preview
- `/team` — directory (Name · Role · Contact · Pay 🔒 Restricted), clickable per-person detail (courses/tasks/leave), "Building now", export CSV
- `/leave` — request form (dates/type/reason), balance, pending approvals (approve/decline-with-reason), clash flags, history
- `/me` — own record, leave balance + history, payslips, attendance, inline contact editing
- `/documents` — document register, version history, required-vs-supplied, expiring-soon, role-access
- `/announcements` — send notices/policies, per-person ack tracking, acknowledge button
- `/events` — create/register/add-tasks/close-with-report, overdue + pacing detection
- `/equipment` — register, fault reporting (voice-ready), repeat-fault detection, fault history
- `/utilities` — short-question capture with 2/day limit indicator + historical view
- `/decisions` — browse/search org-memory, record decisions with reason
- `/hr` — HR-only joining (start/complete steps/overdue chase) + leaving (start/handover/apply separation)
- `/settings` — edit contact, change password, theme + notification preferences
- `/records` — N1 DocType manager (all 150 mapped types): browse, **edit, create, delete, export CSV** — permission-filtered, category-grouped, through the gate with audit + undo
- `/payroll` — HR/admin payslips, salary structures, income-tax slabs (N1 payroll group)
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
| `/today` morning flow | Chat-first brief → plan your day (mandatory time-per-item) → streak rings (appendix A) | ~2-3 hrs | Planned (engine built, UI parked) |

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

### API (44 endpoints)

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
| `/api/people/{id}/payslips` | GET | Pay slips (hr/admin/self) |
| `/api/courses/progress` | GET | Team course progress |
| `/api/courses/{id}` | GET | Course detail + figure |
| `/api/courses/{id}/deck` | POST | Generate deck outline (LLM seam) |
| `/api/org-memory` | GET / POST | List / record decisions |
| `/api/org-memory/{id}` | GET | Retrieve (links permission-filtered) |
| `/api/calendar/{year}/{month}` | GET | Month view |
| `/api/announcements` | GET / POST | List / send announcements |
| `/api/announcements/{id}` | GET | Announcement + non-ackers |
| `/api/assistant/ask` | POST | Coordinator answer (permission-bound) |
| `/api/notifications` | GET | Notifications for the session actor |
| `/api/search` | GET | Global search (permission-filtered) |
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

## Non-negotiables enforced (CONTEXT §13)

| # | Rule | Status |
|---|---|---|
| 1 | One gate; permission + activity log live only there | ✅ |
| 2 | Refusal never discloses a record's existence | ✅ |
| 3 | Money + people + leaving-org never go automatic | ✅ |
| 4 | Autonomy is earned (10 clean) and revocable | ✅ |
| 5 | Voice confirms before saving | ✅ |
| 6 | Daily commitments: conversation-first, mandatory time | ✅ |
| 7 | Two kinds of miss (interrupted vs ran-over) | ✅ |
| 8 | Streaks personal only, never on team screen | ✅ |
| 9 | Assistant comments on work, never the person | ✅ |
| 10 | Exporting ≠ viewing | ✅ |
| 11 | Calendar open + notify + record + undo (atomic) | ✅ |
| 12 | At most two questions per person per day | ✅ |
| 13 | Any figure opens into the parts it was computed from | ✅ |

## Persistence

The spine's record store, activity log and figure store are **async** so a
durable backend drops in. Set **`DATABASE_URL`** (Postgres — Supabase or any) and
`buildDemoWorld()` uses **6 Postgres-backed tables**: `orga_nodes`, `orga_edges`,
`orga_activity`, `orga_figures`, `orga_accounts`, `orga_autonomy_rules` — every
record, relationship, activity entry, figure, credential and graduation state
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
