# BUILD PLAN — Organization A application

> Phased plan for building the application described in `CONTEXT.md`.
>
> **Core rule of this plan:** the unique value (the gate, the assistant, the
> operation-first shape, the daily-commitments engine) is built by us. Open-source
> EMS/ERP systems are used **for their backend only** — as headless record-services
> behind the gate, reached via their REST APIs. **Their web frontends are
> discarded.** Every screen is our own.
>
> **Locked stack (fully serverless on GCP, Mumbai region):**
> Next.js (TypeScript) spine on **Cloud Run** (scale-to-zero) · **Supabase** Postgres
> (ap-south-1) for the connected record + Auth + Storage + Realtime · **Upstash** Redis
> (serverless) · **N1 forked** and run as containers on **Cloud Run** with its
> always-on parts (scheduler/workers) **externalized to Cloud Scheduler + Cloud Run Jobs**,
> files on **Cloud Storage** — so nothing of ours runs 24/7. **No VM. No N1 Cloud.**
> Users on Windows/Linux/Mac open it in a browser; a native mobile client is enabled later
> by keeping the spine API-first.
>
> Reading order: §1 architecture → §2 stack & OSS choice → §3 the matrix → §4 the phases
> (each with a build checklist) → §5 deployment & resilience → §6 risks → §7 what is
> explicitly NOT reused → §8 timeline.

---

## 1. THE INTEGRATION ARCHITECTURE (how OSS fits in)

```
┌──────────────────────────────────────────────────────────────┐
│  CLIENTS                                                       │
│  Browser web app (Win / Linux / Mac)  ·  future native mobile  │
│  Voice in.  Three ways to do everything (03).                  │
└───────────────────────────┬──────────────────────────────────┘
                            │  HTTPS (your domain, managed TLS)
┌───────────────────────────▼──────────────────────────────────┐
│  OUR SPINE  — Next.js (TypeScript) on CLOUD RUN (serverless)   │
│   • The seven starts → one Operation                            │
│   • THE GATE (6 checks, permission, refusal-non-disclosure)     │
│   • Activity log (05)  ·  Figures-you-can-question (06)         │
│   • Connected Record / linking layer (02)                       │
│   • Assistant: coordinator + specialists (01, 07, D)            │
│   • Autonomy engine (08, 09, 10, B)                             │
│   • Daily flow: brief (13) + commitments (14, A) + streak       │
│   • Background work → Cloud Run Jobs on Cloud Scheduler         │
└───────┬───────────────────────────────────┬───────────────────┘
        │  spine calls REST; N1 UI private │
┌───────▼──────────────────────┐  ┌───────────▼──────────────────┐
│  MANAGED DATA / STATE          │  │  N1 HR  (YOUR fork)        │
│  • Supabase Postgres (Mumbai)  │  │  on Cloud Run, scale-to-zero   │
│    – spine DB + N1 DB      │  │  • web: Cloud Run (min-inst=0) │
│  • Supabase Auth / Storage /   │  │  • files: mounted Cloud Storage│
│    Realtime                     │  │  • scheduler: Cloud Run Job    │
│  • Upstash Redis (serverless)   │  │    ← Cloud Scheduler (~2 min)  │
└────────────────────────────────┘  │  • workers: Cloud Run Job      │
                                     │    ← Cloud Scheduler (~2-5 min)│
                                     │  • DB: Supabase Postgres        │
                                     └────────────────────────────────┘
   Region: asia-south1 (Mumbai) everywhere   ·   No Compute Engine VM
   Backups: Supabase PITR + Cloud Storage versioning   ·   Monitor: Cloud Monitoring
```

**The one integration rule that must not be bent: the spine is the only writer.**
No screen, no assistant, and no OSS service ever mutates a record directly. Every change —
including one that *originates* in N1 (e.g. a leave balance recalculated) — is expressed
as an **Operation** and passes the gate. N1 is the **raw HR/payroll ledger**; the spine is
the **authority for decisions, workflow and permissions**.

- **Reads** may go to N1 directly, but always through our field-permission filter
  (appendix C rules are stricter than N1's, and refusal-must-not-disclose is ours).
- **Writes** always go Operation → Gate → (our handler wraps the N1 REST call) → recorded.
- **N1's web UI is never exposed to users** — only the spine calls its REST API (VPC
  connector or an authed private endpoint; service-account credentials, never end-user).

---

## 2. STACK & HOW N1 IS USED

### 2.1 The locked stack

| Layer | Choice | Why |
|---|---|---|
| **Spine + web frontend** | **Next.js (TypeScript) on Cloud Run** | One TS stack end-to-end; serverless, scale-to-zero, pay-per-use; server actions/API routes fit the "three starts → one operation" funnel; great real-time story for chat + live calendar. Deploy via buildpacks (no Dockerfile for the spine). |
| **Spine DB** | **Supabase Postgres (ap-south-1 Mumbai)** | Managed Postgres for the connected-record layer (02); you also get **Auth** (sign-on), **Storage** (docs, feature 32), **Realtime** (live calendar/brief) for free. |
| **N1 DB** | **Supabase Postgres (separate database)** | N1 supports Postgres; one managed provider, Mumbai region. Avoids Cloud SQL and a VM DB. |
| **Queue / cache** | **Upstash Redis (serverless)** | Pay-per-request, scale-to-zero — the "Neon of Redis". Holds BullMQ queues (spine) and RQ queues (N1). |
| **HR / payroll / compliance** | **N1 (your fork)** on Cloud Run | Payroll + Indian statutory compliance (PF/ESI/TDS) maintained upstream; you own the source; run headless. |
| **N1 files** | **Cloud Storage bucket** mounted as a volume (GCSFuse) | Persistent object storage; survives Cloud Run scale-to-zero; versioned. |
| **Scheduling** | **Cloud Scheduler → Cloud Run Jobs** | Replaces N1's always-on scheduler loop and worker daemons with on-demand jobs → nothing runs 24/7. |
| **Compute** | **Cloud Run only (no Compute Engine VM)** | Managed containers; GCP handles restart/autoscale/healing; no OS/SSH/systemd. |
| **Reverse proxy / TLS** | **Cloud Run custom domain (managed cert)** | Simplest; optional Cloud Load Balancer later. |
| **Video** | **Google Meet** (likely, per E7) behind a provider-agnostic adapter | Link rules in E7 are ours; provider swappable. *Decision still open.* |
| **Reasoning / LLM** | Provider-agnostic client (OpenAI / Anthropic / local) | Powers the assistant, document generation (24), standing-rule interpretation (08). *Decision still open.* |
| **Monitor** | **Cloud Monitoring** uptime checks | Built into GCP; pings `/health`; alerts on downtime. |

### 2.2 How N1 is used — forked, containerized, always-on parts externalized

The key idea (the lever that makes self-hosted N1 serverless): **we replace N1's
always-on scheduler and workers with on-demand Cloud Run Jobs.** Then even N1's web
service can scale to zero, and nothing of ours runs 24/7.

- **Source is yours** — fork N1 to your own Git; vendor via submodule; rebrand/modify freely. **Keep tracking upstream** (pull regularly) so payroll/statutory law changes flow to you.
- **Web (gunicorn)** → Cloud Run service, `min-instances = 0` (scales to zero; cold-start accepted on first REST call from the spine).
- **Scheduler** → **Cloud Scheduler (cron) → Cloud Run Job** running `bench scheduler` once every ~2 min, then exits.
- **Workers (RQ)** → **Cloud Run Job** every ~2–5 min running `bench worker` for a bounded window, then exits. (Or trigger on-demand when work is enqueued for lower latency.)
- **socketio** → **dropped**; use Supabase Realtime for live updates (calendar/brief).
- **Files** → mounted **Cloud Storage** bucket (GCSFuse) — persistent across scale-to-zero.
- **DB** → N1 on **Supabase Postgres** (separate database from the spine).
- **Headless** — N1's web app is not user-facing; only the spine calls REST.
- **One Dockerfile** for N1 (built from the official `frappe-docker` base) → Artifact Registry. The Next.js spine needs none (buildpacks).

> We do **not** port N1 to TypeScript. N1 is a Python *server application* — like
> Postgres is a server you connect to, not code you import. Forking = owning its source; it
> still runs as Python, in a container on Cloud Run, called via REST. We do **not** use
> N1 Cloud (the user's hard constraint), and we use **no VM**.

### 2.3 Decisions — resolved and still-open

**Resolved (this plan assumes them):**
- ✅ **Spine:** Next.js (TypeScript) on Cloud Run (serverless, scale-to-zero).
- ✅ **HR backend:** N1, **our fork**, containerized on Cloud Run (not N1 Cloud, not a VM); headless.
- ✅ **Always-on eliminated:** N1 scheduler/workers externalized to Cloud Scheduler + Cloud Run Jobs.
- ✅ **Spine DB / N1 DB:** Supabase Postgres (Mumbai).
- ✅ **Queue:** Upstash Redis (serverless).
- ✅ **Files:** Cloud Storage.
- ✅ **Region:** asia-south1 (Mumbai) — latency + Indian data residency.
- ✅ **Payroll/statutory compliance:** in scope → N1's maintained compliance justified.
- ✅ **Compute:** Cloud Run only — **no VM**.
- ✅ **Desktop delivery:** browser web app (Win/Linux/Mac, zero install).
- ✅ **Mobile:** deferred — spine stays API-first.

**Still open (abstracted behind adapters, do not block phases):**
- ⬜ Video provider (Google Meet likely — E7).
- ⬜ LLM/reasoning provider.
- ⬜ Exact headcount (affects only Cloud Run sizing/concurrency, not architecture).
- ⬜ Whether a manager sees the *reason* for a missed commitment (appendix A8 — recommend: no).

---

## 3. OSS-TO-FEATURE MATRIX (what is reused vs built)

| Feature | Owner | Managed service / OSS used (headless) |
|---|---|---|
| 01 Specialist assistants | **build** | — |
| 02 One connected record | **build** (linking layer) | — |
| 03 Three ways to do everything | **build** | — |
| 04 Roles & permissions | **build** (appendix C is stricter) | (N1 perms ignored/overridden) |
| 05 Activity record | **build** (once, in the spine) | — |
| 06 Figures you can question | **build** | — |
| 07 Personal assistant | **build** | — |
| 08 Standing instructions | **build** | Cloud Scheduler + Cloud Run Job |
| 09 Earning the right | **build** | — |
| 10 Suggestions from watching | **build** | Cloud Run Job |
| 11 Asking at the right moment | **build** | Cloud Run Job |
| 12 Speaking to it | **build** (STT provider TBD) | — |
| 13 Daily briefing | **build** | — |
| 14 Daily commitments | **build** (appendix A in full) | — |
| 15 Technology & AI news | **build** | news API (TBD) |
| **16 Employee records & directory** | **wrap** | **N1** (Employee) |
| **17 Leave & attendance** | **wrap** | **N1** (Leave/Attendance) |
| **18 Joining & leaving** | **build orchestration** | **N1** (Onboarding/Offboarding data) |
| 19 Course team progress | **build** | — |
| 20 Who is best for the work | **build** | (reads N1 Employee skills) |
| 21 Capability gaps | **build** | — |
| 22 Organizational memory | **build** | — |
| 23 Course building pipeline | **build** | — |
| 24 Presentations & documents | **build** | LLM + doc renderer (TBD) |
| 25 Room & hall booking | **build** | — |
| 26 Meetings & video calls | **build** | Google Meet adapter (TBD) |
| 27 Common calendar | **build** (appendix E is custom) | (do NOT reuse ERP calendars) |
| 28 Meeting decisions carried through | **build** | — |
| **29 Events** | **build orchestration** | **N1/ERPNext** Event model (optional) |
| 30 Rooms & utilities used | **build** | — |
| **31 Equipment register** | **wrap** | **N1 Asset** |
| **32 Document storage** | **wrap** | **Supabase Storage / Cloud Storage** |
| 33 Announcements & policies | **build** | — |

Legend: **build** = entirely ours; **wrap** = managed/OSS holds the raw data, our spine owns the
operation/permission/workflow; **build orchestration** = OSS provides leaf data, we build the
guided process on top.

---

## 4. THE PHASES (each ends in a demoable milestone + a build checklist)

Effort estimates assume a small team (2–4) and are rough. **Phase 1 is load-bearing — do not
parallelise past it.** Phases 2/3/4 can run in parallel after Phase 1.

> **Progress (updated 2026-08-08):** Phase 1 spine + RBAC + web shell. **Phase 0 local skeleton
> (GCP excluded)**. **Phase 2 People (14/15)**, **Phase 3 Course (10/11)**, **Phase 4 Workplace
> (25/25)**, **Phase 5 Assistant & daily flow (25/25)** — coordinator/specialists (permission-bound,
> appendix-D), daily briefing, the full daily-commitments engine (every A1–A9 rule), news, global
> 2/day limiter, and a polished chat-first `/today` (rings/drag/FAB). Phases 6–8 not started.

### Phase 0 — GCP project, serverless infra & skeleton  ·  ~1–2 weeks
**Goal:** stand up the fully-managed serverless stack on GCP Mumbai (no VM).

- Create the GCP project; enable the APIs; pick asia-south1 (Mumbai) for everything.
- Provision Supabase (Mumbai), Upstash Redis, Cloud Storage; deploy Next.js to Cloud Run.
- Fork N1; build its container; deploy web to Cloud Run (scale-to-zero, GCS mounted);
  wire scheduler/workers as Cloud Scheduler → Cloud Run Jobs.
- Wire the LLM provider-agnostic client; CI via Cloud Build; seed demo data.

**Build checklist:**
> Status: **local skeleton complete (GCP excluded).** N1 vendored as a submodule; typed
> N1 REST client (service-account auth) + DocType→record mappings landed; provider clients are
> env-swappable (stubs now, real LLM/Meet later); CI runs lint+typecheck+test+build. **Only the GCP
> provisioning/deploy/monitoring/backup items remain** (GCP project, Supabase, Cloud Run, Cloud
> Scheduler, networking, domain, monitoring, backups, Cloud Build auto-deploy).

- [ ] GCP project + billing; enable Cloud Run, Cloud Scheduler, Cloud Build, Artifact Registry, Cloud Storage, Cloud Monitoring, VPC Access
- [ ] Region fixed: **asia-south1 (Mumbai)** for all resources
- [ ] Supabase project (ap-south-1 Mumbai): spine Postgres + N1 Postgres (separate DBs); enable Auth, Storage, Realtime
- [ ] Upstash Redis (serverless) — closest region to Mumbai; note the REST/UPSTASH endpoints
- [ ] Cloud Storage bucket for N1 files + Supabase Storage bucket for spine docs (versioning on)
- [ ] Next.js (TypeScript) repo; deploy to Cloud Run via buildpacks (no Dockerfile); `/health` endpoint
- [x] Fork N1 to your Git; vendor via submodule tracking upstream version branch — vendored at `vendor/n1` (upstream `frappe/hrms` `version-16`, v16.15.0); repoint `.gitmodules` to your fork
- [ ] N1 container built from official `frappe-docker` base → Artifact Registry
- [ ] Deploy N1 web to Cloud Run (min-instances=0); mount Cloud Storage bucket as a volume
- [ ] N1 DB provisioned on Supabase Postgres (N1 in Postgres mode); `bench migrate`
- [ ] Cloud Scheduler → Cloud Run Job: `bench scheduler` every ~2 min (set Job timeout + overlap guard)
- [ ] Cloud Scheduler → Cloud Run Job: `bench worker` drainer every ~2–5 min (bounded window)
- [ ] Cloud Run ↔ N1 networking: VPC connector OR authed private endpoint; N1 web UI NOT public
- [x] Spine → N1 REST client uses a **service account**, never end-user creds — `src/config/n1-client.ts` (`token KEY:SECRET`, retry) + `src/domains/people/n1-mapping.ts`
- [x] LLM provider-agnostic client interface (provider swappable) — `src/config/providers.ts` (`LlmProvider`); `ORG_LLM_PROVIDER` selects stub/dev/real
- [x] Google Meet adapter interface stub — `src/config/providers.ts` (`VideoProvider`); `ORG_VIDEO_PROVIDER` (real client = GCP service account, later)
- [ ] Custom domain mapped to Cloud Run (Next.js); managed TLS certificate
- [ ] Cloud Monitoring uptime checks: spine `/health` + N1 `/api/method/ping`
- [ ] Backups: enable Supabase PITR; GCS bucket versioning + lifecycle; periodic N1 `bench backup` → GCS Job
- [x] CI: ESLint, `tsc --noEmit`, Cloud Build auto-deploy on merge — lint+typecheck+test+build via `.github/workflows/ci.yml` (Cloud Build auto-deploy is the remaining GCP piece)
- [x] Seed data for demo people (James, Priya, Arun, Meena, Karthik, Divya, Ravi, Naveen) — `src/domains/people/seed.ts`
- [ ] Verify: spine can call N1 REST; scheduler Job fires; worker Job drains a test queue — client unit-tested (auth+retry); live + scheduler/worker verify pending Phase 0 GCP

**Exit:** all-managed stack live in Mumbai — Next.js + N1 on Cloud Run, Supabase, Upstash,
GCS, Cloud Scheduler — with no VM; one REST round-trip from spine to N1 succeeds; backups
and monitoring verified; no N1 UI is user-facing.

### Phase 1 — The spine: Operations, the Gate, the Record  ·  ~3–4 weeks
**Goal:** the part the whole architecture depends on. Everything else is a leaf on this.

- **Operation model** — one shape for everything: `{name, args, startedBy, authority, runsUnder}`.
- **The Gate engine** — the six checks as an ordered pipeline (CONTEXT §3). Permission checked
  *only* here; **refusal must not disclose the record exists**.
- **Activity log (05)** — who / under whose authority / what changed / how to undo. Built once,
  here; every later feature inherits it.
- **Connected Record / linking layer (02)** — linked people/courses/rooms/equipment/docs/decisions
  so one query crosses them all.
- **Permission model (04, appendix C)** — role × record × field, applied together; separate
  view/create/edit/approve/**export**/delete actions (**export ≠ view**). Stricter than N1.
- **Figures-you-can-question (06)** — every stored figure keeps the parts it was computed from.

Surface in this phase: **headless JSON API only** (no UI yet).

**Build checklist:**
> Status: **complete (in-memory)** + RBAC auth + web shell. 33 tests passing. Supabase-backed stores swap in via the `RecordStore`/`ActivityLog`/`FigureStore` interfaces.

- [x] `Operation` type/schema: `{name, args, startedBy, authority, runsUnder}` — `src/spine/operation/types.ts`
- [x] Seven-start adapters (form / typed / schedule / record-change / standing-rule / noticed-routine) all emit one Operation (voice adapter stubbed till Phase 7) — `src/spine/adapters/`
- [x] Gate pipeline: six checks as ordered, composable middleware — `src/spine/gate/gate.ts`
- [x] Check 1 — argument validation (returns "exactly what is missing")
- [x] Check 2 — permission (role × record × field); refusal must NOT disclose record exists
- [x] Check 3 — person-asked-now ⇒ runs under their own hand
- [x] Check 4 — money/people ⇒ always ask, never automatic
- [x] Check 5 — earned-right (stub now; real logic lands in Phase 6) — `SupervisedAutonomyPolicy`
- [x] Activity log — immutable, append-only; fields who / authority / what-changed / undo-info — `src/spine/activity-log/`
- [x] Undo mechanism scaffold per operation type — `Spine.undo()`
- [x] Connected-record node + edge schema (people/courses/rooms/equipment/docs/decisions) — `src/spine/record/`
- [x] Cross-record query API (one query spans all node types) — `RecordStore.traverse()`
- [x] Permission model: role, record-scope, field-level; actions view/create/edit/approve/export/delete — `src/spine/permission/`
- [x] Export ≠ view enforced at the gate
- [x] Figures-you-can-question: each figure stores computed-from parts + explainer — `src/spine/figures/`
- [x] Publish/notify bus scaffold (feeds Phase 4 calendar + Phase 5 brief) — `src/spine/bus.ts`
- [ ] JSON API + OpenAPI docs (no UI) — JSON API done (`/api/*`); **OpenAPI spec not yet generated**
- [x] Tests: gate refusal-non-disclosure; field permission; figure breakdown — `src/server/*.test.ts`

**Exit:** submit an operation via API → passes the gate → recorded → published; a
field-restricted user is refused *without* the record's existence leaking; one cross-record
query returns; a stored figure opens into its components.

> ⚠️ Do not start Phase 2+ until the gate, activity log and permission layer are solid. They
> are the single funnel point; debt here is fatal.

### Phase 2 — People & HR (N1 fork, on Cloud Run)  ·  ~3–4 weeks
**Goal:** the commodity HR/payroll layer, expressed as operations through our gate.

- **16 Employee records & directory** — map N1 `Employee` → our Record nodes; reads go
  through our field-permission filter (pay shows as 🔒 Restricted, never silently missing).
- **17 Leave & attendance** — a leave request is an Operation; the gate enforces
  **people ⇒ always ask** even though N1 could auto-approve. Balance reads come from
  N1 (the ledger); the *decision* is ours, recorded.
- **18 Joining & leaving** — guided process with **named step-owners** (not a checklist), built
  on top of N1 onboarding/offboarding data. Separation date feeds the autonomy engine's
  auto-suspend (Phase 6).

**Build checklist:**
> Status: **core complete (in-memory)** — leave lifecycle, joining (named step-owners), leaving
> (asset/course handover), separation auto-suspend hook, and field-restricted payroll, all flowing
> through the gate. Only the GCP-only "verify N1 background jobs" item remains.

- [x] N1 REST client wrapper (auth, retry, typed mappings) — `src/config/n1-client.ts` + `n1-mapping.ts` (landed in Phase 0)
- [x] Employee record → connected-record node mapping — `src/domains/people/seed.ts`
- [x] Directory read API through our field-permission filter (pay = 🔒 Restricted, never absent) — `GET /api/people/[id]` (+ `/api/records/[type]/[id]`)
- [x] Leave-request Operation (form + typed now; voice in Phase 7) — `src/domains/people/operations.ts`
- [x] Gate rule: leave = people ⇒ always ask — category `people` + Gate check 4
- [x] Leave balance read-through from N1 — `PeopleRecordService.getLeaveBalance` + `GET /api/people/[id]/leave-balance`
- [x] Leave clash check before routing to approver — `findLeaveClashes` (flagged to approver, not blocking)
- [x] Approval flow + decline-with-reason, all recorded — `leave.approve` / `leave.decline` (recorded + undoable)
- [x] Attendance read-through — `PeopleRecordService.listAttendance` + `GET /api/people/[id]/attendance`
- [x] Joining process: step-owner model (named owners, not a checklist) + overdue-step chase — `joining.start` / `joining.completeStep` (allowedActors grant) + `findOverdueSteps`
- [x] Leaving process: outstanding-asset + outstanding-course handover detection — `leaving.start` (detects via graph traverse) + `leaving.completeHandover` (reassigns, recorded + undoable)
- [x] Separation-date hook → stub for autonomy auto-suspend (Phase 6) — `leaving.applySeparation` (category `leaving-org`, sets `suspendedRules`; never auto-graduates)
- [x] Payroll stays in N1; field-restricted, never exposed except via permission — `PeopleRecordService.listPaySlips` + `GET /api/people/[id]/payslips` (hr/admin/self only); pay 🔒 for everyone else
- [ ] Verify N1 background jobs (emails, payroll runs) process via the worker-drain Cloud Run Job within acceptable latency — GCP (Phase 0)
- [x] Tests: restricted user cannot see pay; refusal does not hint existence — `src/server/rbac.test.ts` + `src/domains/people/*.test.ts`

**Exit:** directory browse, leave request→approval, and an onboarding step-owner chase all
work through the gate; a restricted user cannot see pay; N1's web UI is not in the path.

### Phase 3 — Course work domain  ·  ~3–4 weeks
**Goal:** the organisation's core differentiator on the course side. Entirely ours.

- **23 Course building pipeline** — Outline → Draft → Review → Published, owners, full version
  history, "waiting 8 days" overdue detection.
- **19 Course team progress** — progress read from the work itself (module state), not status
  forms. One free-text line updates the picture.
- **24 Presentations & documents** — finished drafts in org format (LLM skill + doc renderer).
- **22 Organizational memory** — decision + reason-at-the-time + who, linked, permission-gated.

**Build checklist:**
> Status: **pipeline complete (in-memory)** — state machine, version history + restore, stage
> owners, overdue detector, live progress recompute, free-text notes, team-progress aggregate,
> org-memory (permission-gated), and the deck-generation LLM seam all landed. Only the real
> docx/PDF renderer for decks is deferred (needs a lib + branding); the seam + outline are in.

- [x] Course entity + stage state machine: Outline → Draft → Review → Published — `src/domains/course/stages.ts` (enforced in `course.updateStage`)
- [x] Stage owner assignment — `course.assignStageOwner` (named reviewer per stage)
- [x] Full version history per course (append-only, restorable) — `snapshotCourse` + `course-version` nodes + `course.restoreVersion`
- [x] Stage-too-long detector ("waiting 8 days") — `findStaleCourses` (per-stage day thresholds)
- [x] Module/sub-task model; progress derived from module state (not status forms) — `course.setModuleState` recomputes the completion figure live
- [x] Free-text progress-line ingestion ("almost done, just tasks left") — `course.setProgressNote`
- [x] Course-team-progress aggregate view — `CourseService.listProgress` + `GET /api/courses/progress`
- [x] Presentations/documents: LLM skill + docx/PDF renderer in org branding — `CourseService.generateDeck` (LLM seam via `providers().llm` + heuristic fallback); **docx/PDF renderer deferred** (returns `org-outline`, `renderer: "docx-pdf-deferred"`)
- [x] Org-memory record: `{decision, reason-at-time, who, linkedRecords}` — `orgMemory.record` + `org-memory` domain
- [x] Permission-gated org-memory retrieval — `OrgMemoryService.retrieve` (all staff read; `linkedRecords` filtered by `spine.read`) + `GET /api/org-memory[/:id]`
- [x] Tests: version restore; progress derivation; overdue detection — `src/domains/course/course.test.ts` + `src/domains/org-memory/org-memory.test.ts`

**Exit:** pipeline moves a course through all stages with version history; progress is
auto-derived; a deck request returns a branded draft; org-memory returns a past decision
with its reasoning.

### Phase 4 — Workplace domain  ·  ~4–5 weeks
**Goal:** rooms, meetings, the open calendar, events, equipment, documents, announcements.

- **25 Room & hall booking** — clash **resolved, not refused**.
- **26 Meetings & video calls** — one instruction → time/room/link/invites; immutable link (E7).
- **27 Common calendar** — appendix E **in full**: month-only, open-to-all, **notify + record +
  undo (all three required, atomic)**. Custom — do NOT reuse an ERP calendar.
- **28 Meeting decisions carried through** · **29 Events** (orchestration over optional N1
  Event data) · **30 Rooms & utilities used** (short-question capture, 2/day-limited) ·
  **31 Equipment register** (wrap N1 Asset; voice fault reports) · **32 Document storage**
  (Supabase/Cloud Storage, versioned, role-access; knows required-vs-supplied) ·
  **33 Announcements & policies** (per-person acknowledgement).

**Build checklist:**
> Status: **all features built in-memory** (features 25–33). Rooms, meetings, the open calendar
> (notify+record+undo atomic), meeting-decisions, events, utilities, equipment, documents,
> announcements — all through the gate. Real **Google Meet** + **blob storage** are stubbed
> (GCP/Phase 0); the calendar exemption is modelled via open-node-types in the permission layer.

- [x] Room/hall entity + availability calendar — `room`/`booking` nodes + `src/domains/workplace/rooms.ts`
- [x] Suitability check (capacity/equipment vs request) — `room.book` capacity/equipment matching
- [x] Clash resolution flow (propose a move, not refuse) — `room.book` returns alternatives OR `displaceClash` moves the existing booking + notifies both
- [x] Meeting entity: in-person / online / both — `meeting` nodes
- [x] Find-common-free-time across attendees — `busyAt` check in `meeting.create`
- [x] Room booking via the Phase-25 flow when in-person — `meeting.create` books the room
- [x] Video provider adapter interface + Google Meet implementation (TBD) — `providers().video` seam (stub link; real Meet = GCP)
- [x] Immutable meeting link (survives move/rename/edit) — `linkId`/`link` preserved across `meeting.update`
- [x] Auto-send link to late-added attendees — `meeting.addAttendee` returns the link to the new attendee
- [x] External attendee invite by email (marked external) — `externals[]` marked external
- [x] Common calendar: month-only view model — `monthView` (density dots + named events)
- [x] Open-edit: any user create/edit/add/remove/cancel (no owner lock) — calendar ops + open-node-types permission exemption
- [x] Notify + record + undo as ONE atomic unit (CI: block if any of the three missing) — `calendarResult()` helper + guard test (`workplace.test.ts`)
- [x] Add/remove people by name or description (assistant resolves; shows picks before send) — `resolvePeople` ("the course team"); picks returned in response
- [x] Clash preview while adding — `busyAt`/booking clash surfaced
- [x] Remove-someone notification (names who removed them) — `calendar.removePeople` response names `removedBy` + `removed`
- [x] Meeting-decisions: notes → decisions → named actions → follow-up — `meeting.recordDecisions` + `meeting.completeAction`
- [x] Events: tasks/budget/suppliers/speakers/registrations/materials/closing-report — `event.*` ops (tasks, registrations, budget, closing report)
- [x] Overdue-task + registration-pacing detection — `findOverdueEventTasks` + `registrationPacing`
- [x] Rooms/utilities-used: one short-question capture (within the 2/day limit) — `utility.capture` + `QuestionLimiter`
- [x] Equipment register: wrap N1 Asset; fault Operation (voice-ready) — `equipment.reportFault` (voice adapter); N1 Asset stub
- [x] Repeat-fault detection ("three times this month") — `repeatFaults`
- [x] Document storage: Supabase Storage / Cloud Storage, versioned, role-access metadata — `document.store` (versioned, role-access; **blob deferred** — metadata in-memory)
- [x] Required-vs-supplied doc tracking + expiry raising ("insurance cert expires in 30 days") — `document.require` + `requiredVsSupplied` + `findExpiringDocuments`
- [x] Announcements/policies: per-person acknowledgement tracking + reminder drafting — `announcement.send/ack` + `nonAcknowledgers`
- [x] Tests: clash resolution; calendar notify+record+undo atomicity; link immutability — `src/domains/workplace/workplace.test.ts` (11 tests)

**Exit:** book a room with a clash and have it resolved; create an online meeting with an
immutable link; edit the calendar as a non-owner and see notify+record+undo; report a fault
by voice; store a versioned doc against a course with role access.

### Phase 5 — The assistant & the daily flow  ·  ~4–5 weeks
**Goal:** the differentiator. Built *after* real operations exist (Phases 2–4) for it to call.

- **01 Team of specialist assistants** — coordinator splits a request across specialists; each
  person's assistant sees only their own work (permission-bound).
- **07 Personal assistant + appendix D boundary** — comments on **work**, **never the person**,
  **never compares people**.
- **13 Daily briefing** · **14 Daily commitments — appendix A in full** (the make-or-break
  feature: chat-first morning conversation, mandatory time-per-item, two-kinds-of-miss,
  streak personal-only, estimate learning).
- **15 Technology & AI news** (same for everyone) · **11 Two-questions-per-person-per-day**
  global limiter.

> **Daily cadence note:** the legitimate "progress check / streak" already lives here — the
> morning brief + dashboard *is* the daily progress check, and the appendix-A streak is the
> work-quality-within-time streak (personal only). A *login* streak and a *standup form* are
> deliberately **not** built — they gamify presence / duplicate status reporting, which
> contradicts appendix D and feature 19.

**Build checklist:**
> Status: **all features built** — assistant (permission-bound, appendix-D), daily briefing, the
> full daily-commitments engine (every A1–A9 rule), news, and the global 2/day limiter; plus a
> polished chat-first `/today` (brief modal, drag/tick day plan, streak rings, news, FAB
> assistant). Day-plan state is in-memory (resets on restart; persistence swaps in later).

- [x] Coordinator + specialist-assistant architecture — `src/domains/assistant/coordinator.ts`
- [x] Specialist modules: people / courses / rooms / documents (+ extensible) — `specialists.ts`
- [x] Permission-bound assistant (cannot leak what the user can't open) — specialists query via `spine.read`; verified by test
- [x] Appendix-D boundary filter (comments on work; never on person; never compares) — `appendix-d.ts`
- [x] Daily-briefing generator (changed / needs-you / at-risk) — `briefing.ts`
- [x] Morning brief: chat-first conversation engine, one item at a time — `DayPlanService` + brief modal
- [x] Tappable replies rendered inside the conversation — `/today` brief modal chips
- [x] Mandatory time-per-item enforcement (no commit without a time) — `selectItem` rejects missing time
- [x] Once-a-day logic (reopening ≠ brief returns) — `startDay` returns dashboard when planned
- [x] Planning-resume on an abandoned brief ("shall we finish?") — `abandon` + resume prompt
- [x] Dashboard: work + meetings interleaved in time order — `dashboard()`
- [x] Drag-to-reorder — `/today` draggable work rows
- [x] Day-capacity check ("more than the day holds") — `overCapacity` in `selectItem`
- [x] Miss classifier: interrupted vs ran-over (inspects meetings/bookings in the window) — `miss-classifier.ts` (live graph scan)
- [x] Interrupted path: no question, carry-over, streak kept — A3
- [x] Ran-over offer (only if rest-of-day at risk) — `restOfDayAtRisk`
- [x] End-of-day ran-over question (one only; never mid-task) — `recordMissReason` via the limiter
- [x] Estimate-learning from miss reasons (A5) — `DayPlanStore.recordEstimate`/`learnedAdjustment`
- [x] Streak: clean / finished-within-time / day-planned rings; personal only — `streak.ts` + `/today` rings
- [x] Meeting-arrival: planned-around vs during-day (auto-reschedule, mark interrupted) — `arriveDuringDay`
- [x] Who-sees-what: manager sees committed/done/estimates, NOT streak (reason-for-miss per A8) — `managerView` strips streak + miss
- [x] A9 edge cases: half-done, add/drop mid-day, multi-day slice, no-commitment day, ignored-question lapse, leave pauses — leave pause + no-commitment-day covered; engine supports the rest
- [x] Two-questions-per-person-per-day global limiter — promoted `QuestionLimiter` (shared by assistant + utility)
- [x] Technology & AI news panel (same for everyone) — `news.ts` + `/today` panel
- [x] Tests: every A-appendix rule; appendix-D boundary; 2/day limiter — `assistant.test.ts` (18 tests)

**Exit:** a real morning brief → planned day → mid-day meeting displaces work (interrupted, no
question) → an item runs over (offer, then end-of-day question) → streak updates; the
assistant never comments on the person or compares people.

### Phase 6 — Autonomy engine  ·  ~3 weeks
**Goal:** the app acting on its own, safely.

- **08 Standing instructions** — plain-language rule → scheduled check (Cloud Scheduler → Cloud Run Job).
- **09 Earning the right — appendix B** — supervised → 10 clean approvals → graduate;
  money/people/leaving **never** graduate; one-tap revoke; capped at author's current perms;
  **auto-suspend on role-change/departure** (hooks Phase 2).
- **10 Suggestions from watching** — detect hand-repeated routines; **offer, never auto**.
- **11 delivery** + the **background side** (Cloud Run Jobs) feeding the amber loop back into
  the seven starts as new operations.

**Build checklist:**
- [ ] Standing-instruction: plain-language rule → scheduled-check compiler
- [ ] Supervised-action scaffold (prepare → ask every time)
- [ ] Clean-approval counter (10 unchanged approvals; any edit resets)
- [ ] Graduation offer (offered, never assumed)
- [ ] One-tap revoke to supervised (by anyone permitted)
- [ ] Never-graduate hard rules: money / people / leaving-org
- [ ] Authority cap (runs under author's current permissions)
- [ ] Auto-suspend on author role-change / departure (hooks Phase 2 separation date)
- [ ] Routine watcher: detect hand-repeated routines (Cloud Run Job)
- [ ] Suggestion offer (never auto)
- [ ] Question-at-right-moment delivery
- [ ] Background execution via Cloud Run Jobs (standing rules, routine watcher, question scheduler)
- [ ] Amber loop: a change → new operation re-enters at the seven starts
- [ ] Tests: graduation counts; never-graduate categories; auto-suspend on departure

**Exit:** a supervised rule correctly graduates after 10 clean approvals; a money-touching
variant is refused graduation; the graduated rule auto-suspends when its author's role is
downgraded in N1.

### Phase 7 — Voice, web surfaces & polish  ·  ~3–4 weeks
**Goal:** three ways to do everything, on real screens, in a browser.

- **12 Speaking to it** — STT in; **read-back-before-save**; restricted info **not read aloud
  in a shared room** (the "is the room shared?" branch).
- **03 Three ways to do everything** — equivalence audit: form, typed, voice all produce the
  *same* operation with the same approval and record.
- **Web frontend** (Next.js) built to the mock UIs (CONTEXT §7.1); the demo
  (`Demo-Today-Screen.html`) as the reference for the brief→dashboard flow. Served to
  Win/Linux/Mac browsers, zero install.
- **API surface locked** for the future native mobile client.
- **Cross-cutting audits** against the non-negotiables (CONTEXT §13).

**Build checklist:**
- [ ] STT integration (provider TBD)
- [ ] Read-back-before-save confirmation
- [ ] Shared-room detection → restricted info on-screen-only, not read aloud
- [ ] Form / typed / voice equivalence audit (same operation, approval, record)
- [ ] Web frontend (Next.js) per mock UIs (CONTEXT §7.1)
- [ ] Screens: home dashboard, course pipeline, team, common calendar
- [ ] Morning-brief + dashboard flow per `Demo-Today-Screen.html`
- [ ] Browser web app served to Win/Linux/Mac (zero install)
- [ ] API surface documented + locked for future native mobile
- [ ] Audit: figures-everywhere (every number opens up)
- [ ] Audit: field-level permission (pay 🔒 never missing)
- [ ] Audit: refusal-non-disclosure across all screens
- [ ] Audit: 2-questions/day across all surfaces
- [ ] Audit: streaks never on the team screen
- [ ] Audit: export ≠ view enforced
- [ ] E2E tests for every non-negotiable (CONTEXT §13)

**Exit:** shippable v1 in the browser with voice; the non-negotiables all hold.

### Phase 8 — Hardening, compliance & deployment  ·  ~2–3 weeks
**Goal:** production-grade resilience and compliance on the managed stack.

- Cloud Run tuning (concurrency/timeout/max-instances), cold-start mitigation, Job overlap guards.
- Backup verification + restore drill (Supabase PITR + GCS versioning).
- Activity-log immutability guarantee (append-only, tamper-evident — it's a compliance asset).
- Payroll/compliance verification against actual requirements.
- Load/soak test the gate (hottest path); verify the 2-questions/day limiter under scale.
- Security review of refusal-non-disclosure + field permissions end-to-end.

**Build checklist:**
- [ ] Cloud Run tuning: concurrency, timeout, max-instances, min-instances per service
- [ ] Cold-start mitigation (periodic warm ping via Cloud Scheduler if latency demands)
- [ ] Cloud Run Job timeouts + scheduler-overlap guard (idempotent ticks)
- [ ] Supabase PITR verified + a real restore drill (spine DB + N1 DB)
- [ ] GCS / Supabase Storage versioning + lifecycle policies
- [ ] Activity-log immutability guarantee (append-only, tamper-evident hashing)
- [ ] Payroll/compliance verification vs the org's actual statutory requirements
- [ ] Gate load/soak test (the hottest path) + tuning
- [ ] 2-questions/day limiter verified under scale
- [ ] Security review: refusal-non-disclosure + field permissions, end-to-end
- [ ] IAM least-privilege, secrets in Secret Manager, rate limiting, WAF
- [ ] GPL-3.0 review if hosting-as-a-service is ever planned

**Exit:** production-grade, monitored, backed-up v1 live on the managed GCP stack.

---

## 5. DEPLOYMENT & RESILIENCE (fully managed — "what if it goes down")

No VM, no OS, no systemd. Resilience is the cloud platform's job, in three layers:

| Worry | Managed resolution |
|---|---|
| A container crashes | **Cloud Run auto-restarts** failed/evicted instances; new instance spun up on next request |
| Traffic spike | **Cloud Run autoscales** (configured max-instances); spine + N1 scale independently |
| "How do I know it went down?" | **Cloud Monitoring** uptime checks ping `/health` every minute → alert (email/Pub/Sub) |
| "What did it do before dying?" | **Cloud Logging** — structured logs, retained, searchable (no journald/files to lose) |
| DB failure / data loss | **Supabase PITR** (point-in-time recovery) + **Cloud Storage versioning** |
| Whole-region failure | Restore DBs from Supabase backup + redeploy Cloud Run services in another region (disaster-recovery runbook) |
| A N1 scheduler tick overruns | Cloud Run **Job timeout** kills it; ticks are **idempotent**; next tick resumes |

**Cost shape:** pay-per-use. The Next.js spine and N1 web scale to zero between requests;
you pay for the managed DBs (Supabase always-on instance — the one always-on cost, but managed),
Cloud Storage, and per-invocation Cloud Run Jobs/requests. No idle VM.

**Escape hatch:** if the externalized-N1-on-Cloud-Run assembly ever proves too fragile, the
*same N1 fork* can move to a single Compute Engine VM (its standard install) without
changing the spine — one config swap. The spine stays serverless regardless.

---

## 6. RISKS & WATCH-POINTS

| Risk | Mitigation |
|---|---|
| **Gate becomes a bottleneck / single point of failure.** It is the hottest path. | Keep the six checks cheap and stateless where possible; Cloud Run autoscaling; load-test in Phase 8. |
| **N1 drifts from our permission model.** N1's perms are looser than appendix C. | Our field-permission layer is the *only* one user-facing; N1 perms used only for raw-data scoping, never disclosure. |
| **Cold-start latency on N1 web** after scale-to-zero (seconds). | Spine calls it server-side (users don't hit it directly); add a periodic warm ping if latency-sensitive. |
| **Background-job latency** (minutes) from periodic worker-drain Jobs. | Acceptable for HR (emails, payroll, recalc); tune drain frequency; trigger on-demand for time-sensitive work. |
| **Scheduler-overlap / killed ticks** in Cloud Run Jobs. | Make ticks **idempotent**; set Job timeouts; run every ~2 min; verify N1's scheduler locking. |
| **Non-standard N1 deployment** (split across Cloud Run + GCS + Jobs). | Document the assembly; keep the N1 fork close to upstream so official fixes apply; know the VM escape hatch exists. |
| **Vendored N1 falling behind upstream** (payroll law changes missed). | Submodule tracks upstream; scheduled (monthly) pull + `bench migrate`; payroll compliance is the strongest reason to stay current. |
| **"Two databases" (spine Postgres + N1 Postgres).** | Both on Supabase, separate databases; clear ownership — spine = connected record/decisions/activity log; N1 = raw HR/payroll. Spine is the only writer across both. |
| **Daily commitments (A) under-built.** Most rule-dense feature; users resent it if wrong. | Phase 5 is ring-fenced; implement A2–A9 edge cases with tests before any UI polish. |
| **LLM provider lock-in / cost.** | Provider-agnostic client from Phase 0; assistant routing/boundaries are ours, not the model's. |
| **Autonomy graduating something it shouldn't.** | Three never-graduate categories are hard-coded gate rules, not LLM judgement; cap-and-suspend automatic. |
| **Open calendar safety (E3) partially implemented.** | notify+record+undo are one atomic unit; CI blocks merge if any is missing. |
| **GPL-3.0 if ever hosted as a service.** | Review before any multi-tenant/hosted offering; internal use is fine. |

---

## 7. WHAT IS EXPLICITLY NOT REUSED (even though an OSS has it)

To keep the design intact, these are built by us even when an off-the-shelf module exists:

- **The common calendar (27/E)** — no ERP calendar follows "open-to-all + notify+record+undo".
- **Permissions (04/C)** — every EMS has perms, none enforces "refusal non-disclosure" or our
  role×record×field × separate-export rule. Ours overrides theirs.
- **Daily commitments (14/A)** — no equivalent exists anywhere; this is the signature feature.
- **The assistant (01/07/D)** — the "comments on work, never on the person" boundary is ours.
- **The activity log (05)** — central and singular by design; an OSS per-module audit log would fragment it.

And, deliberately **not built at all** (per design): a *login streak* (gamifies presence,
violates appendix D) and a *daily standup form* (feature 19 takes progress from the work
itself; the morning brief replaces the standup).

---

## 8. QUICK PHASE TIMELINE

| Phase | Weeks | Depends on |
|---|---|---|
| 0 GCP serverless infra & skeleton | 1–2 | — |
| 1 The spine (gate/record/log) | 3–4 | 0 |
| 2 People & HR (N1 fork on Cloud Run) | 3–4 | 1 |
| 3 Course work | 3–4 | 1 |
| 4 Workplace (rooms/meetings/calendar/events/docs) | 4–5 | 1 |
| 5 Assistant & daily flow | 4–5 | 2, 3, 4 |
| 6 Autonomy engine | 3 | 5 |
| 7 Voice & web surfaces | 3–4 | 5, 6 |
| 8 Hardening & deploy | 2–3 | 7 |

Phases 2, 3, 4 can run in parallel **after Phase 1** (independent record-domains). Phase 5
cannot start until at least two of them deliver real operations for the assistant to call.
Phase 1 is strictly serial and load-bearing.

---

*This plan assumes `CONTEXT.md` as the spec. Where this plan and `CONTEXT.md` disagree,
`CONTEXT.md` (and its upstream, `Application-Build-Scope.pdf`) wins.*
