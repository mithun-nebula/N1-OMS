# Handoff — Full Context for a New Session/Device

> **Read this first.** It captures everything an AI needs to pick up this project
> on a new device with full context — what's built, the architecture, the
> environment, what's next, and the user's mindset.
>
> Last updated: 2026-08-10

---

## 1. What this project is

**Organization A** — an assistant-first, operation-based HR/work-management
application for a training/course-publishing organization. The core idea: every
action (form, typed message, voice, or automated schedule) funnels through
**one Gate**, is **recorded**, and **published**. The spec is in
`docs/CONTEXT.md` (the consolidated design doc from the PDF).

**Stack:** Next.js 16 (App Router, TypeScript) + React 19 + Tailwind v4.
**DB:** Postgres (Supabase, via `pg` node driver).
**HR backend:** N1 = forked Frappe HR (`frappe/hrms`), headless REST.
**Not bundled** — clone separately when deploying Frappe.
**Tests:** Vitest (149 unit + 8 Postgres integration).

---

## 2. What's been built (everything below is DONE and verified)

### The spine (load-bearing core)
- **One gate** with 6 checks (arguments → permission → person-asked → money/people → earned-right → run). Stays **synchronous**.
- **Async store interfaces** (RecordStore, ActivityLog, FigureStore) — all `Promise`-returning so a durable backend drops in.
- **6 Postgres tables** (`orga_nodes`, `orga_edges`, `orga_activity`, `orga_figures`, `orga_accounts`, `orga_autonomy_rules`) — every record, relationship, activity entry, figure, credential, and graduation state persists across restarts.
- **Seed guard** — demo data seeded only on first/empty boot; never overwrites real data.
- **Activity log + undo** — every operation recorded with who/authority/changes/undo. Most operations are undoable.

### RBAC + permissions
- 6 roles (super-admin, admin, hr, manager, employee, intern).
- Field-level permissions (pay shows as 🔒 Restricted, never silently hidden).
- Export ≠ viewing (separate permission).
- Intern read-only enforcement (can view but NOT create/edit on open node types).
- Auto-generated permission rules for 150 N1 DocTypes (sensitive = HR/admin; else all-roles view, HR/admin manage).

### All 26 app-UI pages
Dashboard, Tasks, Meetings, Booking, Courses (kanban), Calendar, Team, Leave,
Profile (/me), Documents, Announcements, Events, Equipment, Utilities,
Decisions, HR (joining/leaving), Settings, Admin, RBAC, Records, Payroll,
Expenses, plus Shell with global search, notifications bell, dark-mode toggle,
mobile bottom nav, voice FAB.

### N1 DocType integration
- **150 of 161 N1 DocTypes mapped** via a registry (`src/domains/people/n1-doctypes.ts`).
- **Generic read-through** (`src/server/n1-readthrough.ts`) — pulls live data from Frappe REST when `N1_BASE_URL/KEY/SECRET` set.
- **Demo seed data for all 150 types** — category-aware realistic records (payroll amounts, applicant names, tax slabs, training events, etc.) populated on first boot.
- **`/records` page is a full CRUD manager** — `record.create` / `record.update` / `record.delete` operations through the gate (audited, undoable). Edit modal, create form, delete, CSV export.

### Business logic with real effects
- `leave.approve` decrements the employee's leave balance by inclusive day count (undo restores it).
- Course completion figure recomputes on module-state change (opens into parts).
- Task completion, event closing, meeting cancel — all with real state changes + undo.

### Persistence (durable)
- `DATABASE_URL` (Supabase pooler, transaction-mode, port 6543 + `?pgbouncer=true`) → all 6 tables persist.
- Without it → async in-memory (resets on restart).
- Accounts (`orga_accounts`) — credential changes (password, role, new users) persist.
- Autonomy graduation (`orga_autonomy_rules`) — rule status + clean counts persist.
- Permission owners/teams maps hydrated from static roster + course nodes on boot (restart-safe).

---

## 3. Architecture decisions made (and why)

| Decision | Why |
|---|---|
| **Spine stores are async** | Postgres clients are async; the store interfaces return Promises so durability drops in behind the same interface. |
| **Gate stays synchronous** | The gate's 6-check logic is pure (no I/O). Only permission() and validate() can be async (4 handlers read the graph for record-scoped permission). The gate never awaits stores. |
| **AutonomyLedger stays sync + in-memory hydrated** | The gate's GraduatingAutonomyPolicy consumes it synchronously. On boot: async-hydrate from `orga_autonomy_rules` into the in-memory map, then sync reads + fire-and-forget write-through. |
| **6 tables, JSONB graph store** | `orga_nodes` holds ALL records (discriminated by `type` column, JSONB `data`). No schema migration per new DocType — just a new `type` value. |
| **Supabase pooler** (port 6543, `pgbouncer=true`) | Avoids connection exhaustion on Supabase free tier. Transaction-mode pooling works with `pool.query()` (unnamed prepared statements). SSL auto-enabled for non-local hosts. |
| **Seed guard** (per-type idempotent check) | Seeds demo data only for types that are empty. On restart with real data, existing types are skipped; only gaps are filled. |
| **`/records` full CRUD** | Generic `record.create/update/delete` operations go through the gate. Domain-specific validation stays on dedicated pages (`/leave`, `/tasks`, etc.); the generic CRUD is for direct data management. |

---

## 4. Environment setup

### `.env` (gitignored)
```bash
NODE_ENV=development
ORG_AUTH_SECRET=dev-insecure-secret-change-me-in-prod
ORG_LLM_PROVIDER=stub        # set to "dev" for canned LLM responses
ORG_VIDEO_PROVIDER=stub      # meeting links are fake URLs until wired

# Postgres (Supabase pooler — transaction-mode for the app)
DATABASE_URL="postgresql://postgres.<ref>:<password>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<ref>:<password>@<region>.pooler.supabase.com:5432/postgres"

# N1 (leave unset for stub mode; set when Frappe is live)
# N1_BASE_URL=https://n1.example/api/resource
# N1_API_KEY=
# N1_API_SECRET=
```

### Commands
```bash
npm run dev          # Next.js dev server → http://localhost:3000
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest run (149 tests; 8 Postgres tests skip without DATABASE_URL)
npm run test:watch   # Vitest watch mode
npm run test:db      # Vitest ONLY the Postgres durability tests (loads .env → DATABASE_URL)
```

### Demo logins
`superadmin/super123` · `admin/admin123` · `hr/hr123` ·
`manager/manager123` · `employee/employee123` · `intern/intern123`.

### ⚠️ Security note
The Supabase DB password was accidentally printed in a previous session. **Rotate it** if not already done (Supabase → Settings → Database → Reset password).

---

## 5. What's next (the roadmap — planned, not yet built)

Six features, sequenced quick-wins → big feature:

| # | Feature | Effort | Description |
|---|---|---|---|
| 27 | **Team standup** (`/standup`) | ~1 hr | 3-line daily check-in (yesterday/today/blockers); manager sees full team grid |
| 28 | **Task deadlines on calendar** | ~30 min | Amber markers for task due dates on `/calendar` month grid |
| 29 | **Deadline reminders** | ~30 min | Auto-notify assignee + lead when a task is due within 24h (PublishBus) |
| 30 | **Team/role task assignment** | ~1 hr | Assign to "Course Team" / "Ops Team" (resolves to individuals, multi-create) |
| 31 | **Team workload view** | ~45 min | Per-person open-task count + meeting hours on `/team` |
| 32 | **Personal morning flow** (`/today`) | ~2-3 hrs | Restore appendix-A: chat-first brief → plan your day → streak rings. Engine built + tested, needs UI. |

After these: **GCP deploy** (Phase 0/8 — the user will do this on a different system), real LLM/Meet/blob providers (Wave 2 — needs API keys).

---

## 6. The user's mindset

- **Wants real functional stuff** — not demos. Data must persist, logic must have real effects (e.g., leave approval decrements balance).
- **Cares about durability** — chose Supabase Postgres specifically. Data surviving restarts is non-negotiable.
- **All 6 features at once** — when asked "which direction?", said "all of those."
- **Pragmatic** — accepts the gate stays sync (not a religious argument), accepts fire-and-forget for autonomy writes, accepts generic CRUD without domain-specific validation.
- **Wants comprehensive docs** — every change should be reflected in docs so a new session/AI can pick up seamlessly.
- **GCP later** — will deploy on a different system; not needed now.
- **Supabase connection** — uses the pooler (port 6543, transaction-mode, `pgbouncer=true`).

---

## 7. How to pick up (for the new AI session)

1. **Read `AGENTS.md`** — the agent-facing spine instructions (commands, layout, roles, API, non-negotiables, status).
2. **Read `docs/STATUS.md`** — current build status, all pages, persistence, test counts.
3. **Read `docs/TODO.md`** § "Roadmap — Team workflow features" — the 6 planned features.
4. **Run `npm run lint && npm run typecheck && npm test`** — confirm everything is green.
5. **Run `npm run dev`** → http://localhost:3000 → log in as `hr/hr123` → browse `/records` → verify CRUD works.
6. **Run `npm run test:db`** — if `.env` has `DATABASE_URL`, the 8 Postgres durability tests run against Supabase.
7. **Start building** Feature 27 (team standup) per the plan in `docs/TODO.md`.

---

## 8. Key files to know

| File | What it is |
|---|---|
| `AGENTS.md` | Start here — commands, layout, roles, API, non-negotiables, status |
| `docs/CONTEXT.md` | The consolidated design spec (from the PDF — the upstream authority) |
| `docs/STATUS.md` | Build status — what works, screens, persistence, deferred items |
| `docs/TODO.md` | Feature tracker — 26 done + 6 planned (roadmap) |
| `docs/BUILD-PLAN.md` | Phase-by-phase build plan with progress notes |
| `src/server/bootstrap.ts` | Composition root — builds the world (stores + policy + registers ops + seeds) |
| `src/server/runtime.ts` | Process-singleton world (async `getWorld`/`getSpine`/services) for API routes |
| `src/spine/spine.ts` | The facade: submit → gate → execute → record → publish |
| `src/spine/gate/gate.ts` | The 6-check gate (stays synchronous) |
| `src/server/store-pg-*.ts` | Postgres store implementations (record/activity/figures) |
| `src/server/accounts.ts` | Credential store (sync reads, async mutations, DB write-through) |
| `src/domains/people/n1-doctypes.ts` | N1 DocType registry (150 types, 8 categories) |
| `src/domains/people/n1-demo-seed.ts` | Demo data generator for all 150 DocTypes |
| `src/domains/shared/record-ops.ts` | Generic `record.create/update/delete` operations |
| `.env` | Environment config (DATABASE_URL, N1 vars, provider selection) |
| `.env.example` | Template with documented vars (copy to `.env`) |
