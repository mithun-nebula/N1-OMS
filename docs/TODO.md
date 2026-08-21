# TODO — Feature Gaps & Missing UI

> Generated from a full audit of backend operations vs exposed UI, role-based
> access issues, and general application gaps.
>
> Last updated: 2026-08-09

---

## High Priority — Core workflow gaps

### 1. Leave management page (`/leave`) ✅ DONE
- [x] Employee: request leave form (dates, type, reason)
- [x] Manager: approve / decline with reason — buttons on dashboard + dedicated page
- [x] Leave balance display (per employee)
- [x] Leave clash check surfaced in the UI (flagged, not blocking)
- [x] Leave history per employee
- Backend: `leave.request` (widened to persist type/reason), `leave.approve`, `leave.decline`.
- Done: `src/app/leave/` (page + client). Dashboard has inline Approve + link to `/leave`
  for decline-with-reason.

### 2. Dashboard interactivity ✅ DONE
- [x] Approve / decline leave directly from dashboard pending-approvals card
- [x] Quick-complete task from dashboard (checkbox)
- [x] Click-through from dashboard cards to detail pages
- [x] Role-aware dashboard content (intern sees less than manager)
- Done: `src/app/dashboard/dashboard-client.tsx`. Inline Approve on the card; decline
  (needs a reason) lives on `/leave` via the card link. Stat cards + section headers
  are click-throughs. Pending-approvals card only renders for manager/hr/admin.

### 3. Profile page (`/profile` or `/me`) ✅ DONE — built at `/me`
- [x] View own employee record (name, role, contact, team)
- [x] Leave balance + leave history
- ~~Payslips~~ **OMITTED for now (product call, 2026-08)** — no payslip surface anywhere in the app; node type, seed and permission rules remain so it can return cleanly
- [x] Attendance history
- [x] Edit own contact info (self-scope `edit` already permitted)
- Backend: `/api/people/{id}`, `/api/people/{id}/leave-balance`, `/api/people/{id}/attendance` exist (`…/payslips` removed with the omission).
- Done: `src/app/me/`. Pay/performance render as 🔒 Restricted when field-gated. Added
  the `employee.updateContact` operation (registered in people domain) for inline contact
  editing — permission is the existing self-scope `edit` rule.

### 4. Calendar create / edit / undo ✅ DONE
- [x] Create calendar entry (event or meeting) from the month grid
- [x] Edit entry (time, date, title, detail)
- [x] Add / remove people (by name or description — resolve picks)
- [x] Cancel entry
- [x] Undo toast with `[ OK ] [ Undo ]` buttons
- [x] Clash preview while adding people
- Backend: `calendar.create`, `calendar.edit`, `calendar.addPeople`, `calendar.removePeople`, `calendar.cancel` all exist.
- Done: `src/app/calendar/calendar-client.tsx`. Clickable month grid → day panel with
  create/edit/add-people/remove-person/cancel. Undo toast hits a new
  `POST /api/activity/[id]/undo` endpoint (spine already supported `undo`; no route existed).

### 5. Intern permission fix (read-only enforcement) ✅ DONE
- [x] Restrict `OPEN_NODE_TYPES` so interns can `view` but NOT `create`/`edit` on workplace nodes
- [x] Option A: remove `create`/`edit` from the open set for read-only roles
- [x] Option B: add a role check in the gate — intern gets view-only on open types
- [x] Test: intern cannot create tasks, book rooms, or schedule meetings
- ~~Current bug: `OPEN_NODE_TYPES` grants ALL roles `view + create + edit` — interns should be read-only per spec.~~ Fixed.
- Done (Option B): `src/spine/permission/policy.ts` — `PermissionPolicy` now takes a
  `readOnlyRoles` set (default `["intern"]`); read-only roles get `view` only on open
  node types. Tests added in `src/server/rbac.test.ts` proving an intern is denied
  create/edit on tasks/rooms/calendar while an employee is still allowed. Refusal stays
  opaque (non-negotiable #2).

---

## Medium Priority — Feature pages (backend exists, no UI)

### 6. Documents page (`/documents`) ✅ DONE
- [x] List documents filed against records (course, employee, event)
- [x] Upload form (metadata + blob ref — real blob deferred to cloud)
- [x] Version history per document
- [x] Required-vs-supplied tracking ("Insurance certificate expires in 30 days")
- [x] Role-access display (who can see this doc)
- Backend: `document.store`, `document.require`, `findExpiringDocuments`, `requiredVsSupplied` exist.
- Done: `src/app/documents/`. Expiring-soon banner, store form, version + required/supplied status, role access column.

### 7. Messages page (`/messages`) ✅ DONE — replaced Announcements entirely (2026-08)
- [x] One-to-one chat with every active person + one "Everyone" group
- [x] Deliberately NO RBAC — every signed-in role (interns included) chats; the only
      rule is identity (you can only open your own DMs)
- [x] Outside the operations gate (like the day plan): no audit-log entries, DMs private
- [x] Unread badges, last-message previews, optimistic send, 4s polling, mobile list-first
- [x] Durable in Postgres (`orga_messages`, `orga_message_reads`)
- Backend: `/api/messages` (GET state / POST send + mark-read); `/announcements` redirects here.
- Announcements + ack tracking removed by product call; `notify.send` (writes nothing,
  bell-only) remains for autonomy rules.

### 8. Events page (`/events`) ✅ DONE
- [x] Create event (title, date, capacity, budget)
- [x] Task list (add, complete, overdue detection)
- [x] Registrations (register, pacing detection)
- [x] Closing report
- Backend: `event.create`, `event.addTask`, `event.register`, `event.close` exist.
- Done: `src/app/events/`. Create/register/add-tasks/close-with-report; overdue + capacity + budget surfaced.

### 9. Equipment page (`/equipment`) ✅ DONE
- [x] Equipment register (list, who holds it, condition)
- [x] Report fault form (voice-ready, repeat-fault detection)
- [x] Fault history per equipment
- Backend: `equipment.reportFault`, `repeatFaults` exist — only accessible via voice FAB.
- Done: `src/app/equipment/`. Register + inline fault report + repeat-fault banner + fault history.

### 10. Onboarding / Offboarding page (`/hr`) ✅ DONE
- [x] HR-only page for joining (start onboarding, complete steps, overdue chase)
- [x] Offboarding (start, handover detection, complete handover, apply separation)
- [x] Step-owner model visualisation (named owners per step)
- Backend: `joining.start`, `joining.completeStep`, `leaving.start`, `leaving.completeHandover`, `leaving.applySeparation` exist.
- Done: `src/app/hr/` (HR/admin only). Overdue-chase banner, step owners, handover completion, apply separation.

### 11. Org-memory page (`/decisions`) ✅ DONE
- [x] Browse/search past decisions
- [x] Record a new decision (title, decision, reason, linked records)
- [x] Permission-gated linked-record display
- Backend: `orgMemory.record`, `/api/org-memory` exist.
- Done: `src/app/decisions/`. Search + record form; view is role-gated (employee/intern read, manager/hr create).

### 12. Utility capture page (`/utilities`) ✅ DONE
- [x] Short-question form (room/utility, detail, time range)
- [x] 2/day limit indicator (remaining today)
- [x] Historical view (look back over any period)
- Backend: `utility.capture` + `QuestionLimiter` exist.
- Done: `src/app/utilities/`. Remaining-today indicator + from/to history filter.

---

## Medium Priority — Pages that need editing / interactivity

### 13. Courses (`/courses`, nav renamed from "Projects" 2026-08-19) kanban editing ✅ DONE
- [x] **Course creation decided + built (2026-08-19):** manager+ create (`course.create`), admin-level delete (`course.delete`), and `course.assign` — 1–3 people work a course together, each getting their own linked task (top-down tasks: employees never create, only update status of their assigned ones; each role sees its own board — self / own-team / all).
- [x] Personal view: "Working on / Worked" sections driven by the viewer's course-linked tasks.
- [x] Drag card to change stage (outline → draft → review → published) — implemented as stage buttons honouring valid transitions
- [x] Click card → detail view (modules, progress, version history)
- [x] Edit module state (setModuleState — recomputes completion figure)
- [x] Add progress note (free-text)
- [x] Restore a prior version
- [x] Assign stage owner (reviewer)
- Backend: `course.updateStage`, `course.setModuleState`, `course.setProgressNote`, `course.restoreVersion`, `course.assignStageOwner` exist.
- Done: `src/app/courses/courses-client.tsx`. Click a card → modal with modules/versions/notes/owners.

### 14. Meetings page — add edit/cancel ✅ DONE
- [x] Cancel meeting (ends link)
- [x] Edit meeting (move/rename — preserves immutable link)
- [x] Add attendee (auto-sends link)
- Backend: `meeting.update`, `meeting.cancel`, `meeting.addAttendee` exist.
- Done: `src/app/meetings/meetings-client.tsx`. Inline edit + cancel + add-attendee.

### 15. Tasks page — add edit/delete/filter ✅ DONE
- [x] Edit task title / description
- [x] Delete task (admin/super-admin)
- [x] Change priority after creation
- [x] Filter by assignee / project / priority
- [x] Due-date reminders / overdue badge
- Backend: added `task.edit` + `task.delete` operations (registered) + task delete/export permission rules. Tests in `src/domains/tasks/tasks.test.ts`.
- Done: `src/app/tasks/tasks-client.tsx`.

### 16. Team page — per-person detail ✅ DONE
- [x] Click a person → detail view (their courses, tasks, leave, attendance)
- [x] Per-person course progress (detailed, not just bars)
- [x] Their pending tasks
- [x] Their leave history + balance
- Done: `src/app/team/team-client.tsx`. Clickable directory rows → detail modal.

### 17. Dashboard — role-aware content ✅ DONE
- [x] Intern: minimal (assigned tasks, read-only overview)
- [x] Employee: own tasks, own leave, own courses
- [x] Manager: team tasks, pending approvals, team course progress
- [x] HR: pending onboardings, policy acks, outstanding documents
- [x] Admin: system status, user count, autonomy rules summary
- Done: `src/app/dashboard/dashboard-client.tsx`. Pending-approvals (manager+), HR attention card, Admin system card, click-throughs.

---

## Low Priority — Polish & general app features

### 18. Notifications panel ✅ DONE
- [x] Bell icon in sidebar showing unread notifications
- [x] Feed from `PublishBus` history (who changed what)
- [x] "Arun moved Thursday's review from 11:00 to 15:00" style messages
- Backend: `PublishBus.published()` / `forActor()` — new `GET /api/notifications`.
- Done: `src/app/chrome/notifications.tsx` (bell + dropdown, polls every 30s).

### 19. Global search ✅ DONE
- [x] Search bar in sidebar (people, courses, tasks, meetings)
- [x] Fuzzy match across record types
- [x] Permission-filtered results
- Done: `src/app/chrome/global-search.tsx` + `GET /api/search` (permission-filtered via `spine.read` for employees).

### 20. Dark mode toggle ✅ DONE
- [x] Toggle in sidebar (system / light / dark)
- [x] Persist preference in localStorage
- CSS classes already exist (`dark:`) — just no control.
- Done: `src/app/chrome/theme-toggle.tsx`. Tailwind v4 `@custom-variant dark` + no-flash script in `layout.tsx`; system preference is the default and the toggle overrides.

### 21. Mobile bottom navigation ✅ DONE
- [x] Bottom nav bar (Dashboard / Calendar / ✦ / Team / More) per mock UIs
- [x] Replace the basic mobile header in Shell
- [ ] Responsive breakpoints for all pages (pages are responsive via existing grid classes; not exhaustively QA'd)
- Done: `MobileBottomNav` in `src/app/shell.tsx`.

### 22. Loading & error states ✅ DONE
- [x] Skeleton / spinner during server-render load
- [x] Error boundary page (graceful, not raw stack trace)
- [x] Empty-state illustrations + call-to-action (not just "No data")
- Done: `src/app/loading.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`; pages have empty-state copy with actions.

### 23. Export UI ✅ DONE
- [x] "Download" / "Export CSV" button on directory, tasks, courses
- [x] Respects `export ≠ view` permission (HR/admin only where applicable)
- Backend: `canExport()` — new `GET /api/export` (gated), plus task export rules in `policy.ts`.
- Done: `src/app/chrome/export-button.tsx` wired into team/tasks/courses.

### 24. Settings / preferences page (`/settings`) ✅ DONE
- [x] Edit own profile (contact, display name) — contact editable; display-name is admin-managed (noted)
- [x] Notification preferences
- [x] Change password
- [x] Theme preference (dark/light)
- Done: `src/app/settings/` + `POST /api/settings/password` (+ `changePassword` in accounts.ts).

### 25. Admin page enhancements ✅ DONE
- [x] Activity log viewer (filterable by actor, operation, date)
- [x] Announcement management (create, view acks, send reminders) — covered by `/announcements`
- [x] System configuration (provider modes, env status) — already present
- [x] Full user management (create, edit, delete, reset password) — create/role + reset-password (PUT); delete deferred
- Done: `src/app/admin/admin-client.tsx` — added activity-log viewer + reset password (`resetPassword` in accounts.ts, `PUT /api/admin/accounts/[username]`).

### 26. Misc cleanup ✅ DONE
- [x] Remove dead `/api/brief`, `/api/day`, `/api/news` routes (were for /today, now removed)
- [ ] Remove dead assistant day-plan code (DayPlanService, DayPlanStore, etc.) if /today is permanently gone — **kept** (still has active tests + assistant module cohesion; low-risk to leave)
- [x] Update `docs/STATUS.md` to reflect the new page structure
- [x] Update `docs/BUILD-PLAN.md` progress (Phase 5 partially superseded by dashboard removal) — added progress/UI notes to the summary, Phase 5 status block, and Phase 7 screens line
- Done: deleted the 3 route files + their openapi entries; STATUS.md + BUILD-PLAN.md updated.

---

## Summary — App UI gaps

| Category | Items | Done | Backend ready? |
|---|---|---|---|
| High priority (core gaps) | 5 | **5 ✅** | ✅ all backend exists |
| Medium — feature pages | 7 | **7 ✅** | ✅ all backend exists |
| Medium — page editing | 5 | **5 ✅** | ✅ all backend exists |
| Low — polish | 9 | **9 ✅** | Mostly frontend |
| Roadmap — team workflow | 6 | 0 planned | ✅ engine built for /today; rest is new |
| **Subtotal** | **32** | **26 ✅ + 6 planned** | |

> **Progress 2026-08-09:** All 26 app-UI gaps are now built. Added operations:
> `employee.updateContact`, `task.edit`, `task.delete`; added endpoints:
> `/api/notifications`, `/api/search`, `/api/export`, `/api/activity/[id]/undo`,
> `/api/settings/password`; removed dead `/api/brief`, `/api/day`, `/api/news`.
>
> **Persistence + real logic (2026-08-09):** the spine's record/activity/figure
> stores are now **async** with a **Postgres** implementation (`src/server/store-pg-*.ts`)
> — set `DATABASE_URL` and every node, edge, activity entry and figure survives
> restarts (seed guard keeps real data). Gate stays synchronous. `leave.approve`
> now **decrements the employee's leave balance** by the inclusive day count (undo
> restores it). lint + typecheck green; **149 tests pass** (+5 Postgres integration
> tests skip without `DATABASE_URL`). The N1 DocType mapping below (150 of 161
> mapped) is the remaining integration backlog.

---

## Roadmap — Team workflow features (2026-08-10)

Six new features planned. Sequenced quick-wins → big feature.

### 27. Team standup (`/standup`)
- [ ] New operation `standup.post` (date, yesterday, today, blockers) — stored as `type=standup` node
- [ ] `/standup` page: 3-line form (what I did / what I'm doing / blockers) → today's team feed
- [ ] Once-a-day (re-posting overwrites yours for today); manager sees full team grid
- [ ] Add to nav + `OPEN_NODE_TYPES`
- Status: **planned** — self-contained, ~1 hr

### 28. Task deadlines on calendar
- [ ] Show task due dates as amber markers on the `/calendar` month grid (alongside teal meeting dots + named events)
- [ ] Day panel lists tasks due that day
- [ ] Legend: meetings (teal) / events (named) / task deadlines (amber ◆)
- Status: **planned** — UI change only, ~30 min
- Note: deviates from spec appendix E1 (deadlines excluded from calendar), but practically useful

### 29. Deadline reminders
- [ ] New function `checkTaskDeadlines(graph, bus)` — finds tasks due within 24h, publishes notification to assignee + team lead
- [ ] Wire into the autonomy tick (`/api/autonomy/tick`) or a dedicated `/api/cron/deadlines` route
- [ ] Notifications land in the existing notifications bell (`/api/notifications` reads PublishBus)
- Status: **planned** — uses existing PublishBus + autonomy engine, ~30 min

### 30. Team / role task assignment
- [ ] Task create form gains a multi-select "People" chip-selector (like calendar's add-people) alongside single-assignee dropdown
- [ ] Options include "Course Team" / "Ops Team" / "Everyone" (resolved via existing `resolvePeople` helper)
- [ ] When a team is selected → creates one task per resolved member (each through the gate individually)
- [ ] Toast: "Created 5 tasks (one per course-team member)"
- Status: **planned** — no new operation (UI resolves + multi-create), ~1 hr

### 31. Team workload view
- [ ] Per-person capacity indicator on `/team` (open-task count + meeting hours this week)
- [ ] Simple load bar in the directory or per-person detail modal
- [ ] Uses existing graph data (tasks + meetings) — no new fields
- Status: **planned** — UI enhancement, ~45 min
- Note: full hours-committed-vs-free capacity needs task time estimates (Feature 32 / appendix A)

### 32. Personal morning flow (`/today` — appendix A)
- [ ] Restore `/today` page: chat-first morning **brief modal** (one item at a time, tappable chip replies)
- [ ] Brief → "what are you doing today?" → pick work items → mandatory time-per-item
- [ ] Day appears as **time-ordered rows** (meetings + committed work, tickable, drag-reorder)
- [ ] **Streak rings** (clean / finished-within-time / day-planned) — personal only, "only you see this"
- [ ] Tally: "Meetings 1h 30m · Work 4h · Free 1h 30m"
- [ ] Once-a-day logic (reopening → straight to dashboard, no brief return)
- [ ] Two-kinds-of-miss: interrupted (meeting took the time, no question, streak kept) vs ran-over (one short question later, streak breaks)
- [ ] Re-enable API routes for the day-plan service (`/api/today/start`, `select`, `commit`, `tick`)
- Status: **planned** — the engine (`getDayPlanService()`) is built + tested + async; needs the UI. ~2-3 hrs
- Reference: `docs/mock-ui/Demo-Today-Screen.html` for the exact flow

---

## N1 (Frappe HR) — DocType gaps

N1 has **161 DocTypes**. Previously mapped **3** (Employee, Leave Application, Attendance).
**Now: 150 DocTypes mapped via the registry** (`src/domains/people/n1-doctypes.ts`) +
generic read-through (`src/server/n1-readthrough.ts`), permission rules auto-generated
in `policy.ts`, and full CRUD at `/records`. Each mapped DocType has: a mapping, a
nodeType + category, permission rules (sensitive = HR/admin; else all-roles view), and
read-through that pulls from N1 when `n1Mode() === "live"`.

### What we've mapped

| N1 DocType | Our node type | Status |
|---|---|---|
| `Employee` | `employee` | ✅ specific mapper + UI (directory, dashboard, profile) |
| `Leave Application` | `leave` | ✅ specific mapper + operations (request/approve/decline) |
| `Attendance` | `attendance` | ✅ specific mapper + read-through |
| `Salary Slip` | `payslip` | ⏸ registry-mapped, but **omitted from every UI surface** (product call, 2026-08) |
| … + 146 more | (see registry) | ✅ registry-mapped, permission-gated, **full CRUD** at `/records` |

---

### Critical — Payroll & Indian statutory (46 DocTypes)

Cannot run an organisation without these. Every one is available via N1 REST.

- [ ] **Salary structures** — `Salary Structure`, `Salary Component`, `Salary Detail`,
      `Salary Structure Assignment`, `Bulk Salary Structure Assignment`
      Define pay grades, components (basic, HRA, allowances, deductions), assign to employees.
- [ ] **Payslip generation** — `Salary Slip`, `Payroll Entry`, `Payroll Period`,
      `Payroll Period Date`, `Payroll Settings`
      Monthly payroll runs, automated payslip creation, posting to accounting.
      **ON HOLD: payslips are omitted from the application for now (product call, 2026-08).**
- [ ] **Indian income tax** — `Income Tax Slab`, `Income Tax Slab Other Charges`,
      `Taxable Salary Slab`, `Employee Tax Exemption Declaration`,
      `Employee Tax Exemption Declaration Category`, `Employee Tax Exemption Category`,
      `Employee Tax Exemption Sub Category`, `Employee Tax Exemption Proof Submission`,
      `Employee Tax Exemption Proof Submission Detail`
      TDS calculation, 80C/80D/HRA exemptions, old vs new regime, proof collection.
- [ ] **Gratuity** — `Gratuity`, `Gratuity Rule`, `Gratuity Rule Slab`,
      `Gratuity Applicable Component`
      Gratuity accrual & calculation per Payment of Gratuity Act.
- [ ] **Benefits** — `Employee Benefit Application`, `Employee Benefit Application Detail`,
      `Employee Benefit Claim`, `Employee Benefit Detail`, `Employee Benefit Ledger`
      Medical reimbursement, LTA, flexi-benefits.
- [ ] **Additional compensation** — `Additional Salary`, `Arrear`, `Retention Bonus`,
      `Employee Incentive`, `Overtime Slip`, `Overtime Type`,
      `Overtime Details`, `Overtime Salary Component`
      One-off payments, arrears correction, retention/incentive bonuses, overtime.
- [ ] **Salary controls** — `Salary Withholding`, `Salary Withholding Cycle`,
      `Payroll Correction`, `Payroll Correction Child`, `Payroll Employee Detail`
      Hold salary (e.g. during notice), correct posted payroll.

### Critical — Recruitment & Onboarding (21 DocTypes)

Growing org needs a hiring pipeline.

- [ ] **Job openings** — `Job Opening`, `Job Opening Template`, `Job Requisition`,
      `Staffing Plan`, `Staffing Plan Detail`
      Open positions, hiring plan, headcount budgeting.
- [ ] **Applicants** — `Job Applicant`, `Job Applicant Source`
      Track candidates, source, status (applied → screening → interviewed → offered).
- [ ] **Interviews** — `Interview`, `Interview Detail`, `Interview Type`,
      `Interviewer`, `Interview Feedback`, `Skill Assessment`
      Schedule interviews, collect feedback, score candidates.
- [ ] **Offers** — `Job Offer`, `Job Offer Term`, `Job Offer Term Template`,
      `Offer Term`, `Appointment Letter`, `Appointment Letter Content`,
      `Appointment Letter Template`
      Generate offer letters with terms, appointment letters.
- [ ] **Referrals** — `Employee Referral`
      Track employee referrals + referral bonus eligibility.
- [ ] **Onboarding (detailed)** — `Employee Onboarding`, `Employee Onboarding Template`,
      `Employee Boarding Activity`
      Note: we have a custom `joining.start` operation — but N1's onboarding is richer
      (boarding activities, templates, document tracking).

### High — Leave (advanced, 17 DocTypes)

We have basic request/approve. N1 has the full leave management suite.

- [ ] **Leave policies** — `Leave Type`, `Leave Policy`, `Leave Policy Assignment`,
      `Leave Policy Detail`
      Define leave types (casual, sick, earned, compensatory), policy per grade/role.
- [ ] **Allocations** — `Leave Allocation`, `Leave Period`, `Leave Ledger Entry`
      Allocate leave balance per period, track ledger (earned → used → balance).
- [ ] **Block lists** — `Leave Block List`, `Leave Block List Date`,
      `Leave Block List Allow`
      Block leave during critical periods, allow exceptions.
- [ ] **Encashment** — `Leave Encashment`
      Convert unused leave to payout.
- [ ] **Advanced types** — `Compensatory Leave Request`, `Earned Leave Schedule`,
      `Leave Adjustment`, `Leave Control Panel`
      Comp-off, earned-leave auto-accrual, bulk adjustments.

### High — Expense & Travel (14 DocTypes)

Everyday employee need.

- [ ] **Expense claims** — `Expense Claim`, `Expense Claim Type`,
      `Expense Claim Detail`, `Expense Claim Account`, `Expense Claim Advance`,
      `Expense Taxes and Charges`
      Submit expenses (travel, food, misc), approval flow, accounting integration.
- [ ] **Travel requests** — `Travel Request`, `Travel Itinerary`,
      `Travel Request Costing`, `Purpose of Travel`
      Request travel, itinerary, cost estimation, approval.
- [ ] **Advances** — `Employee Advance`
      Salary advance / travel advance, repayment tracking.
- [ ] **Vehicles** — `Vehicle Log`, `Vehicle Service`, `Vehicle Service Item`
      Company vehicle logbook, service history, fuel tracking.

### High — Attendance & Shifts (12 DocTypes)

Beyond basic attendance read-through.

- [ ] **Check-in/out** — `Employee Checkin`, `Employee Attendance Tool`,
      `Upload Attendance`
      Biometric/device integration, bulk upload, attendance regularization.
- [ ] **Shifts** — `Shift Type`, `Shift Assignment`, `Shift Assignment Tool`,
      `Shift Request`, `Shift Location`, `Shift Schedule`,
      `Shift Schedule Assignment`
      Define shifts, assign employees, shift-swap requests, shift locations.
- [ ] **Attendance requests** — `Attendance Request`, `Holiday List Assignment`
      Employee-initiated correction, holiday list per department/location.

### Medium — Performance & Appraisal (19 DocTypes)

- [ ] **Appraisal cycles** — `Appraisal`, `Appraisal Cycle`, `Appraisal Template`,
      `Appraisal Goal`, `Appraisal KRA`, `Appraisal Template Goal`, `Appraisee`
      Annual/quarterly appraisal cycles, self-assessment, manager review.
- [ ] **Feedback** — `Employee Performance Feedback`,
      `Employee Feedback Criteria`, `Employee Feedback Rating`
      360-degree feedback, structured criteria.
- [ ] **Goals & KRAs** — `Goal`, `KRA`
      OKR-style goal tracking, key result areas.
- [ ] **Skills** — `Skill`, `Employee Skill`, `Employee Skill Map`,
      `Designation Skill`, `Expected Skill Set`
      Skill matrix, gap analysis (complements our course capability-gaps feature).

### Medium — Training (7 DocTypes)

Complements our course pipeline.

- [ ] **Training programs** — `Training Program`, `Training Event`,
      `Training Event Employee`
      Define training programs, schedule events, enroll employees.
- [ ] **Feedback & results** — `Training Feedback`, `Training Result`,
      `Training Result Employee`
      Post-training feedback, pass/fail results.
- [ ] **Employee training** — `Employee Training`
      Training history per employee.

### Medium — Employee lifecycle (13 DocTypes)

Beyond our custom joining/leaving operations.

- [ ] **Promotion & transfer** — `Employee Promotion`, `Employee Transfer`
      Promotion with new pay grade, inter-department transfer.
- [ ] **Separation (detailed)** — `Employee Separation`, `Employee Separation Template`,
      `Exit Interview`
      Note: we have `leaving.start` + `leaving.applySeparation` — but N1's is richer
      (separation templates, structured exit interviews).
- [ ] **Full & final settlement** — `Full and Final Statement`,
      `Full and Final Asset`, `Full and Final Outstanding Statement`
      Calculate dues, asset recovery, outstanding loans/advances at exit.
- [ ] **Grievance** — `Employee Grievance`, `Grievance Type`
      Employee grievance redressal tracking.
- [ ] **Organisation** — `Employee Grade`, `Employment Type`,
      `Employee Cost Center`, `Department Approver`
      Grade/level management, cost-center allocation, delegated approvers.
- [ ] **Daily work summary** — `Daily Work Summary`, `Daily Work Summary Group`,
      `Daily Work Summary Group User`
      Standup-style daily summary (N1's version — we deliberately built a richer one
      via the assistant day-plan, but N1's is available if needed).

---

## Summary — N1 DocType gaps

| Category | DocTypes | Priority | Our layer |
|---|---|---|---|
| Payroll & statutory | 46 | **Critical** | ✅ registry-mapped + `/payroll` page |
| Recruitment & onboarding | 21 | **Critical** | ✅ registry-mapped + joining ops |
| Leave (advanced) | 17 | **High** | ✅ registry-mapped + request/approve ops |
| Expense & travel | 14 | **High** | ✅ registry-mapped + `/expenses` page |
| Attendance & shifts | 12 | **High** | ✅ registry-mapped + read-through |
| Performance & appraisal | 19 | **Medium** | ✅ registry-mapped + full CRUD |
| Training | 7 | **Medium** | ✅ registry-mapped + full CRUD |
| Employee lifecycle | 13 | **Medium** | ✅ registry-mapped + leaving ops |
| **Total mapped** | **149** | | ✅ via registry (`SUPPORTED_DOCTYPES`) |
| Already specifically mapped | 3 | | ✅ (Employee / Leave Application / Attendance) |
| Remaining unmapped | ~9 | | niche child/table DocTypes — generic fallback covers them |

### How to wire a new N1 DocType (pattern)

The registry now automates steps 1–3 for every DocType. To add a new one:

1. **Register** — add an entry to the relevant group in
   `src/domains/people/n1-doctypes.ts` (`{ doctype, nodeType, category, sensitive? }`).
   The generic mapper camelCases N1 fields automatically; add `fields` only for renames.
2. **Permission rules** — auto-generated by `n1GeneratedRules()` in `policy.ts`
   (sensitive → HR/admin view+export; else all-roles view, HR/admin edit). No hand-edit.
3. **Read-through** — automatic via `N1ReadThroughService` (`src/server/n1-readthrough.ts`)
   which calls `n1-client.ts` when `n1Mode() === "live"`.
4. **Operations** — optional; add custom workflow (like `leave.request`) in a domain +
   register it. N1-native writes (payroll runs, accounting post) go through N1 directly.
5. **UI page** — the `/records` page is a **full CRUD manager** covering every
   mapped DocType (catalog `/api/n1-doctypes`, list `/api/records-list?type=`).
   Generic `record.create` / `record.update` / `record.delete` operations
   (through the gate, audited, undoable) let HR/admin edit any record, create
   new ones, delete (admin), and export CSV. Add a dedicated page only where
   custom workflow warrants it (e.g. `/payroll`, `/expenses`).
6. **Tests** — mapping (`n1-doctypes.test.ts`) + read-through + permission gating
   (`n1-readthrough.test.ts`).
