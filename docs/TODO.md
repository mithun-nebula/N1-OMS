# TODO — Feature Gaps & Missing UI

> Generated from a full audit of backend operations vs exposed UI, role-based
> access issues, and general application gaps.
>
> Last updated: 2026-08-08

---

## High Priority — Core workflow gaps

### 1. Leave management page (`/leave`)
- [ ] Employee: request leave form (dates, type, reason)
- [ ] Manager: approve / decline with reason — buttons on dashboard + dedicated page
- [ ] Leave balance display (per employee)
- [ ] Leave clash check surfaced in the UI (flagged, not blocking)
- [ ] Leave history per employee
- Backend: `leave.request`, `leave.approve`, `leave.decline` all exist — just no UI.

### 2. Dashboard interactivity
- [ ] Approve / decline leave directly from dashboard pending-approvals card
- [ ] Quick-complete task from dashboard (checkbox)
- [ ] Click-through from dashboard cards to detail pages
- [ ] Role-aware dashboard content (intern sees less than manager)

### 3. Profile page (`/profile` or `/me`)
- [ ] View own employee record (name, role, contact, team)
- [ ] Leave balance + leave history
- [ ] Payslips (field-gated: employee sees own, HR/admin sees all)
- [ ] Attendance history
- [ ] Edit own contact info (self-scope `edit` already permitted)
- Backend: `/api/people/{id}`, `/api/people/{id}/leave-balance`, `/api/people/{id}/attendance`, `/api/people/{id}/payslips` all exist.

### 4. Calendar create / edit / undo
- [ ] Create calendar entry (event or meeting) from the month grid
- [ ] Edit entry (time, date, title, detail)
- [ ] Add / remove people (by name or description — resolve picks)
- [ ] Cancel entry
- [ ] Undo toast with `[ OK ] [ Undo ]` buttons
- [ ] Clash preview while adding people
- Backend: `calendar.create`, `calendar.edit`, `calendar.addPeople`, `calendar.removePeople`, `calendar.cancel` all exist — calendar page is read-only.

### 5. Intern permission fix (read-only enforcement)
- [ ] Restrict `OPEN_NODE_TYPES` so interns can `view` but NOT `create`/`edit` on workplace nodes
- [ ] Option A: remove `create`/`edit` from the open set for read-only roles
- [ ] Option B: add a role check in the gate — intern gets view-only on open types
- [ ] Test: intern cannot create tasks, book rooms, or schedule meetings
- Current bug: `OPEN_NODE_TYPES` grants ALL roles `view + create + edit` — interns should be read-only per spec.

---

## Medium Priority — Feature pages (backend exists, no UI)

### 6. Documents page (`/documents`)
- [ ] List documents filed against records (course, employee, event)
- [ ] Upload form (metadata + blob ref — real blob deferred to cloud)
- [ ] Version history per document
- [ ] Required-vs-supplied tracking ("Insurance certificate expires in 30 days")
- [ ] Role-access display (who can see this doc)
- Backend: `document.store`, `document.require`, `findExpiringDocuments`, `requiredVsSupplied` exist.

### 7. Announcements page (`/announcements`)
- [ ] List announcements (message, by, date, outstanding ack count)
- [ ] Send announcement / policy (HR/manager/admin)
- [ ] Acknowledge button (per-person tracking)
- [ ] Reminder draft to non-ackers
- Backend: `/api/announcements`, `/api/announcements/{id}` exist — just no page in nav.

### 8. Events page (`/events`)
- [ ] Create event (title, date, capacity, budget)
- [ ] Task list (add, complete, overdue detection)
- [ ] Registrations (register, pacing detection)
- [ ] Closing report
- Backend: `event.create`, `event.addTask`, `event.register`, `event.close` exist.

### 9. Equipment page (`/equipment`)
- [ ] Equipment register (list, who holds it, condition)
- [ ] Report fault form (voice-ready, repeat-fault detection)
- [ ] Fault history per equipment
- Backend: `equipment.reportFault`, `repeatFaults` exist — only accessible via voice FAB.

### 10. Onboarding / Offboarding page (`/hr`)
- [ ] HR-only page for joining (start onboarding, complete steps, overdue chase)
- [ ] Offboarding (start, handover detection, complete handover, apply separation)
- [ ] Step-owner model visualisation (named owners per step)
- Backend: `joining.start`, `joining.completeStep`, `leaving.start`, `leaving.completeHandover`, `leaving.applySeparation` exist.

### 11. Org-memory page (`/decisions`)
- [ ] Browse/search past decisions
- [ ] Record a new decision (title, decision, reason, linked records)
- [ ] Permission-gated linked-record display
- Backend: `orgMemory.record`, `/api/org-memory` exist.

### 12. Utility capture page (`/utilities`)
- [ ] Short-question form (room/utility, detail, time range)
- [ ] 2/day limit indicator (remaining today)
- [ ] Historical view (look back over any period)
- Backend: `utility.capture` + `QuestionLimiter` exist.

---

## Medium Priority — Pages that need editing / interactivity

### 13. Projects (`/courses`) kanban editing
- [ ] Drag card to change stage (outline → draft → review → published)
- [ ] Click card → detail view (modules, progress, version history)
- [ ] Edit module state (setModuleState — recomputes completion figure)
- [ ] Add progress note (free-text)
- [ ] Restore a prior version
- [ ] Assign stage owner (reviewer)
- Backend: `course.updateStage`, `course.setModuleState`, `course.setProgressNote`, `course.restoreVersion`, `course.assignStageOwner` exist.

### 14. Meetings page — add edit/cancel
- [ ] Cancel meeting (ends link)
- [ ] Edit meeting (move/rename — preserves immutable link)
- [ ] Add attendee (auto-sends link)
- Backend: `meeting.update`, `meeting.cancel`, `meeting.addAttendee` exist.

### 15. Tasks page — add edit/delete/filter
- [ ] Edit task title / description
- [ ] Delete task (admin/super-admin)
- [ ] Change priority after creation
- [ ] Filter by assignee / project / priority
- [ ] Due-date reminders / overdue badge

### 16. Team page — per-person detail
- [ ] Click a person → detail view (their courses, tasks, leave, attendance)
- [ ] Per-person course progress (detailed, not just bars)
- [ ] Their pending tasks
- [ ] Their leave history + balance

### 17. Dashboard — role-aware content
- [ ] Intern: minimal (assigned tasks, read-only overview)
- [ ] Employee: own tasks, own leave, own courses, payslip summary
- [ ] Manager: team tasks, pending approvals, team course progress
- [ ] HR: pending onboardings, policy acks, outstanding documents
- [ ] Admin: system status, user count, autonomy rules summary

---

## Low Priority — Polish & general app features

### 18. Notifications panel
- [ ] Bell icon in sidebar showing unread notifications
- [ ] Feed from `PublishBus` history (who changed what)
- [ ] "Arun moved Thursday's review from 11:00 to 15:00" style messages
- Backend: `PublishBus.published()` exists — just no UI.

### 19. Global search
- [ ] Search bar in sidebar (people, courses, tasks, meetings)
- [ ] Fuzzy match across record types
- [ ] Permission-filtered results

### 20. Dark mode toggle
- [ ] Toggle in sidebar (system / light / dark)
- [ ] Persist preference in localStorage
- CSS classes already exist (`dark:`) — just no control.

### 21. Mobile bottom navigation
- [ ] Bottom nav bar (Dashboard / Calendar / ✦ / Team / More) per mock UIs
- [ ] Replace the basic mobile header in Shell
- [ ] Responsive breakpoints for all pages

### 22. Loading & error states
- [ ] Skeleton / spinner during server-render load
- [ ] Error boundary page (graceful, not raw stack trace)
- [ ] Empty-state illustrations + call-to-action (not just "No data")

### 23. Export UI
- [ ] "Download" / "Export CSV" button on directory, tasks, courses
- [ ] Respects `export ≠ view` permission (HR/admin only where applicable)
- Backend: `canExport()` exists — just no button.

### 24. Settings / preferences page (`/settings`)
- [ ] Edit own profile (contact, display name)
- [ ] Notification preferences
- [ ] Change password
- [ ] Theme preference (dark/light)

### 25. Admin page enhancements
- [ ] Activity log viewer (filterable by actor, operation, date)
- [ ] Announcement management (create, view acks, send reminders)
- [ ] System configuration (provider modes, env status)
- [ ] Full user management (create, edit, delete, reset password)

### 26. Misc cleanup
- [ ] Remove dead `/api/brief`, `/api/day`, `/api/news` routes (were for /today, now removed)
- [ ] Remove dead assistant day-plan code (DayPlanService, DayPlanStore, etc.) if /today is permanently gone
- [ ] Update `docs/STATUS.md` to reflect the new page structure
- [ ] Update `docs/BUILD-PLAN.md` progress (Phase 5 partially superseded by dashboard removal)

---

## Summary — App UI gaps

| Category | Items | Backend ready? |
|---|---|---|
| High priority (core gaps) | 5 | ✅ all backend exists |
| Medium — feature pages | 7 | ✅ all backend exists |
| Medium — page editing | 5 | ✅ all backend exists |
| Low — polish | 9 | Mostly frontend |
| **Subtotal** | **26** | |

---

## N1 (Frappe HR) — DocType gaps

N1 has **161 DocTypes**. We've mapped **3** (Employee, Leave Application, Attendance).
Each unmapped DocType needs: a mapping in `n1-mapping.ts`, permission rules in
`policy.ts`, optionally custom operations, and a UI page.

### What we've mapped (3 of 161)

| N1 DocType | Our node type | Status |
|---|---|---|
| `Employee` | `employee` | ✅ mapped + UI (directory, dashboard) |
| `Leave Application` | `leave` | ✅ mapped + operations (request/approve/decline) |
| `Attendance` | `attendance` | ✅ mapped + read-through |
| `Salary Slip` | `payslip` | ⚠️ referenced in service but not mapped in `n1-mapping.ts` |

---

### Critical — Payroll & Indian statutory (46 DocTypes)

Cannot run an organisation without these. Every one is available via N1 REST.

- [ ] **Salary structures** — `Salary Structure`, `Salary Component`, `Salary Detail`,
      `Salary Structure Assignment`, `Bulk Salary Structure Assignment`
      Define pay grades, components (basic, HRA, allowances, deductions), assign to employees.
- [ ] **Payslip generation** — `Salary Slip`, `Payroll Entry`, `Payroll Period`,
      `Payroll Period Date`, `Payroll Settings`
      Monthly payroll runs, automated payslip creation, posting to accounting.
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

| Category | DocTypes | Priority | Our custom layer? |
|---|---|---|---|
| Payroll & statutory | 46 | **Critical** | ❌ nothing |
| Recruitment & onboarding | 21 | **Critical** | ⚠️ partial (joining.start) |
| Leave (advanced) | 17 | **High** | ⚠️ partial (request/approve only) |
| Expense & travel | 14 | **High** | ❌ nothing |
| Attendance & shifts | 12 | **High** | ⚠️ partial (read-through only) |
| Performance & appraisal | 19 | **Medium** | ❌ nothing |
| Training | 7 | **Medium** | ❌ nothing (our course pipeline is separate) |
| Employee lifecycle | 13 | **Medium** | ⚠️ partial (leaving operations) |
| **Total unmapped** | **149** | | |
| Already mapped | 3 | | ✅ |

### How to wire a new N1 DocType (pattern)

For each DocType group above, the work is:

1. **Map** — add to `src/domains/people/n1-mapping.ts`
   (`mapXyz(record: N1Record)` → our node shape).
2. **Permission rules** — add to `src/server/policy.ts`
   (who can `view`/`edit`/`export` the new node type).
3. **Read-through** — extend `PeopleRecordService` (or a new domain service)
   to pull via `n1-client.ts` when `n1Mode() === "live"`.
4. **Operations** — if we add custom workflow (like `leave.request`),
   add handlers in the domain + register them.
5. **UI page** — server component + Shell + client interactivity.
6. **Tests** — mapping + permission + read-through.
