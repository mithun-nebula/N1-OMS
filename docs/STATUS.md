# Project Status — N1-OMS

> Last updated: 2026-08-08
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

- `/today` — morning brief (chat-first conversation), day plan (drag-to-reorder, tickable), streak rings, tech & AI news, FAB assistant
- `/courses` — 4-column kanban (Outline→Draft→Review→Published), module progress bars, "waiting N days" overdue cards
- `/team` — directory (Name · Role · Contact · Pay 🔒 Restricted), "Building now" progress, capability gaps — no streaks
- `/calendar` — month grid with density dots + named events

### Voice

- Hold ✦ → speak → read-back modal → confirm or cancel ("Nothing is saved")
- Shared-room toggle: restricted info on-screen only, not read aloud
- Works in Chrome/Edge (Web Speech API)

### API (36 endpoints)

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
| `/api/figures/{type}/{id}` | GET | Figure + computed-from breakdown |
| `/api/activity` | GET | Query the activity log |
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
| `/api/brief` | GET | Daily briefing |
| `/api/day` | GET / POST | Start day / dashboard / plan actions |
| `/api/news` | GET | Technology & AI news |
| `/api/autonomy/tick` | POST | Background tick (Cloud Scheduler) |
| `/api/autonomy/rules` | GET / POST | Rules + suggestions / accept-revoke |
| `/api/openapi.json` | GET | This API spec |

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
vendor/         vendored OSS (git submodules)
  n1/           N1 = our HR/payroll backend (upstream frappe/hrms, version-16)
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

## Deferred items

| Item | Phase | Reason |
|---|---|---|
| GCP provisioning, Cloud Run, Supabase, Cloud Scheduler | 0 / 8 | Cloud infra — needs GCP project + billing |
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
npm test             # Vitest run (124 tests)
npm run test:watch   # Vitest watch mode
```

## Environment

Copy `.env.example` to `.env`. Defaults work for local dev.
Set `N1_BASE_URL` / `N1_API_KEY` / `N1_API_SECRET` when N1 (Frappe) is live.
Set `ORG_LLM_PROVIDER=dev` for canned LLM responses (assistant/deck).
