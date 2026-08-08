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

## Summary

| Category | Items | Backend ready? |
|---|---|---|
| High priority (core gaps) | 5 | ✅ all backend exists |
| Medium — feature pages | 7 | ✅ all backend exists |
| Medium — page editing | 5 | ✅ all backend exists |
| Low — polish | 9 | Mostly frontend |
| **Total** | **26** | |
