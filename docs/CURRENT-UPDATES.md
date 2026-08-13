# Current Updates

> Working notes. Everything decided, built or discovered in the current round of
> work, with enough detail to pick up from cold.
>
> Last updated: 2026-08-13

---

## 0 · Where we are right now

| | |
|---|---|
| **Database** | Live Supabase Postgres (`ap-southeast-2`), transaction pooler on 6543 |
| **Demo data** | Off — real people only |
| **Accounts** | `admin` (super-admin) · `ananya` (HR) · `rohit` (employee) |
| **Tests** | 214 passing, 11 skipped |
| **Build** | Clean — lint, typecheck, production build |
| **Blocks done** | 0 (integrity) · 4 (UI components) · 1 (employee records) · Phase 0 security |
| **Blocks skipped** | 2 (departments) — reporting lines already work through the directory |

### What actually works today

Sign-in with six roles and real field-level permissions · add, edit and
deactivate real people with their logins · tasks · meetings · room booking ·
shared calendar · leave requests and approvals · documents register ·
announcements with acknowledgement tracking · events · equipment and faults ·
organisational memory · 162 HR record types browsable · everything audited,
most of it undoable.

### What does not exist yet

Attendance (nobody can clock in) · a general approval flow (only leave can be
approved) · real file upload · the day-plan screen · notifications that survive
a restart · role-specific dashboards.

---

## 1 · Security — closed this round

Found by a twelve-agent audit, then verified line by line. **All were live
against the real database.**

### The four holes

**1. Any employee could change their own pay.** One request.

```
POST /api/operations
{ "start":"form", "name":"record.update",
  "args": { "nodeType":"employee", "nodeId":"<own id>", "data": { "pay": 9999999 } } }
```

`record.update` declared its permission need without naming the fields it
writes. The permission layer only tests fields when told which ones, so it
skipped. The rule marking pay restricted was never consulted, and your own
record is inside your own `self` scope.

**2. Any employee could act as anyone, including a super-admin.** Four requests.
`ruleAuthor` was taken from the request body and never compared to the session.
Confirming your own parked operation silently *created* a persisted rule.
`acceptGraduation` never read the clean count. `hasEarnedRight` ignored which
operation was running, so one graduated rule unlocked all fifty.

**3. Undo bypassed the gate entirely** — no permission check of any kind — and
`GET /api/activity` returned every entry, including pay history, to any session.

**4. Refusals disclosed records.** Argument validation ran *before* the
permission check and its message was returned verbatim:
`"James still manages 5 people (Priya, Arun, Karthik, Divya, Meena)."` to an
intern. This one was introduced while building Block 1.

### The fixes

| Change | File |
|---|---|
| `record.*` declares the fields it writes, and flags money/people by node type at call time | `src/domains/shared/record-ops.ts` |
| Application starts must name yourself, against a rule that already exists | `src/app/api/operations/route.ts` |
| Graduation requires its ten clean approvals | `src/domains/autonomy/engine.ts` |
| An earned right belongs to a rule **and** an operation | `src/spine/gate/autonomy.ts` |
| Only the author (or an admin) can revoke a rule | `src/domains/autonomy/engine.ts` |
| Rules are created only by `registerRule`, never as a side effect | `src/domains/autonomy/engine.ts` |
| A rule may only emit the operation it declared | `src/domains/autonomy/compiler.ts`, `engine.ts` |
| Undo checks permission on every record it touches | `src/spine/spine.ts` |
| The activity log is filtered, values stripped unless you may see those fields | `src/app/api/activity/route.ts` |
| **Permission now runs before argument validation** | `src/spine/gate/gate.ts` |

**`src/spine/security.test.ts`** — 11 tests, written as the attacks themselves.
Every one failed before the fix.

### Two things worth knowing

**The gate's check order changed.** The spec documents arguments-first. A
permitted user sees no difference; someone who would be refused now learns
nothing. This contradicts the written order and is deliberate.

**The compiler and the ledger disagreed about what a rule is.** The ledger
grants a right to a rule *and* an operation; a rule could emit anything. Rules
now declare their operation up front and are refused if they emit anything else.

---

## 2 · The dashboard

### The shape

**One dashboard, not six.** A common core everyone sees, with an extra block at
the bottom that changes by role.

Six separate screens was wrong for one reason: **everyone is a person with work
to do first, and a role second.** A manager still has their own day. Six screens
means duplicating that or dropping it.

```
DESKTOP (≥1024px)
┌────────────────────────────────────────────────────────┐
│ Good morning, Ananya             [ Clock in ]  09:12   │
│  ◍◍◍   3 of 5 done · 4h 30m committed · 1h 30m free   │
│        12 clean days · only you see this               │
└────────────────────────────────────────────────────────┘
┌──────────────────────────────┬─────────────────────────┐
│ YOUR DAY                     │ 2 WAITING ON YOU        │
│ 09:00 ☐ Module 4 draft   2h  │ · Priya's leave         │
│ 11:00 ▣ Review w/ Arun   1h  │ · Policy to acknowledge │
│ 12:00 ☑ Contract sign   30m  ├─────────────────────────┤
│ 14:00 ☐ Spreadsheet      2h  │ [role block]            │
│         carried over — mtg   │                         │
└──────────────────────────────┴─────────────────────────┘

MOBILE   same blocks, single column, same order.
```

### Clock in / clock out drives the day

The user's idea, and better than "the brief appears on first open" — it is a
deliberate action rather than an ambush, it gives real hours worked, and the
close-out has an obvious moment instead of guessing when the day ended.

```
CLOCK IN   →  brief: what is waiting for you
              pick today's work, time estimate on each (required)
              →  your day appears

CLOCK OUT  →  what got done? anything unfinished → why?
              →  feeds tomorrow's brief
```

**Rules:**
- Everyone clocks in, including managers and admins
- Never clocking in is fine — the dashboard still offers "Plan my day"
- Unfinished items carry to tomorrow with their reason; "no longer needed" does not
- The reason picker does **not** consume the two-questions-a-day limit — that cap
  is for questions the system starts, not a form you opened yourself

### The rings measure today, not history

iOS Fitness maps onto the day, and the stated priority is current activity.

| Ring | Fills with |
|---|---|
| Outer | items finished ÷ items committed |
| Middle | items finished **inside their estimate** ÷ items finished |
| Inner | (meeting time + committed work) ÷ 8h — how full the day is |

The **streak is a number beside the rings**, not a ring. The spec warns that a
prominent streak makes people pad estimates, which corrupts the estimate
learning it feeds. Marked *"only you see this"* — never shown to a manager.

### Three things the reference designs do not have

1. **The time tally** — `4h 30m committed · 1h 30m free`. Required by the spec.
   It is what stops someone committing six hours to a day holding three hours of
   meetings.
2. **A cause tag on each row** — `carried over — meeting` vs `ran over`. Showing
   the cause is what stops the screen feeling like a supervisor. Never ask why
   something did not finish when a meeting the system booked took the time.
3. **A real empty state.** "Nothing planned yet" is what you will see most for a
   while. It has to look like an invitation, not a broken page.

### Role blocks

| Role | Extra block | Data available |
|---|---|---|
| employee | — | |
| intern | — (same core, no create buttons) | |
| manager | **Your team** — leave awaiting them, approve/decline inline | real today |
| hr | **People** — joiners, leavers, unacknowledged notices | real today |
| admin / super-admin | **Both of the above, org-wide** | real today |

**No system-health block.** Here "admin" is the head of the organisation, not a
sysadmin. Provider status and table sizes stay on `/admin`.

### What the dashboard work needs built

1. **Attendance slice** — `attendance.checkIn`, `attendance.checkOut`, plus a
   holiday list. Ids `att_<employee>_<YYYY-MM-DD>` so ownership resolves without
   a database read. Plus the privacy fix: today every role can read everyone's
   attendance and leave.
2. **Day-plan persistence** — `orga_day_plans`, `orga_streaks`,
   `orga_estimate_learning`. Write-behind so reads stay synchronous and the 13
   existing tests are untouched. *(Started — the optional persistence interface
   and `load()` are already in `src/domains/assistant/day-plan/store.ts`.)*
3. **`/api/today`** — `acknowledgeBrief · select · remove · reorder · commit ·
   tick · missReason · closeOut`. The engine behind it already exists with 13
   passing tests and no callers.
4. **The dashboard itself** — rewrite `src/app/dashboard/` on the Block 4
   components, with data assembly in `data.ts` as pure functions so it is
   testable.

---

## 3 · The agentic approach

### The definition

> **An assistant that covers every feature in the application, adapts to the role
> of whoever is asking, and can act on their behalf — capped at exactly what that
> person could do by hand.**

Not a system that runs the company. Four levels, in increasing order of trust:

| Level | What it means |
|---|---|
| **Guides** | Tells you what this part of the app is for and what you can do here |
| **Notices** | Watches the records and tells you what needs attention |
| **Prepares** | Builds the action for you, filled in correctly, and asks |
| **Acts** | Does it alone, once it has earned that right, and can undo it |

The first three are where nearly all the value sits, and they are far cheaper
than the fourth.

### The ceiling, and why to keep it

Money, employment, and anyone leaving can never happen automatically. That is
**11 of the 50 operations**, and they are the eleven with the most value in them.
The assistant will never approve leave, set pay or deactivate someone on its own.
It can prepare every one of them perfectly and ask.

### Where the assistant lives

One assistant, one voice, two places:

- **A chat** — anything with substance. You open it. **It never opens itself
  while you are working.**
- **A small prompt on the page** — single things answerable in one tap, where you
  are already working. Every prompt carries "explain in chat".

Interrupting to *help* is welcome. Interrupting to *ask* is not. Same moment,
opposite effect.

Neither surface exists today.

### Per role, in short

| Role | The assistant's job |
|---|---|
| **Employee** | Get through the day. Prepares requests, warns before they fail. Never commits your day for you. |
| **Intern** | Learn where things are. **Never offers an action they cannot take.** |
| **Manager** | What needs them, how the team is doing. Prepares approvals with the context to decide. Never shows a streak or a miss reason. |
| **HR** | Keep the people system honest. Joiners, leavers, expiring documents, unread policies. Never sets pay. |
| **Admin (head person)** | The organisation, not one team. What is waiting, what is stuck, what is at risk. |
| **Super-admin** | The above, plus what the assistant itself has been doing — and how to stop it. |

### The order

| Phase | What | Time |
|---|---|---|
| 0 | Close the security holes | ✅ done |
| 0.5 | A daily digest — "here's what needs attention" | 2 days |
| 1 | Make supervision real — a "waiting on you" screen | 8 days |
| 2 | Make the background safe — scheduler, idempotency, concurrency | 9 days |
| **3** | **🎯 First genuinely agentic capability** — notices at 6am, prepares, a person decides | 2 days |
| 4 | Earned autonomy — acts alone on small reversible things | 5 days |
| 5 | Language — type or say a sentence | 21 days |
| 6 | The day plan, and the rest | 33 days |
| 7 | Skills — who is best, capability gaps | 8 days |

**~122 working days — six months.** Real unattended autonomy at **week six**.

The digest is the highest value per day in the whole plan: five of the seven
detectors already run, the gap is that nobody is told. **Call it a digest, not an
agent.**

### What stays manual, deliberately

Pay, employment status, reporting lines · confirmation itself, with **no timeout
escalation ever** (silence is not consent) · writing the standing rules ·
choosing your own daily commitments · deleting and cancelling · taking someone
else's room booking · anything writing into the HR system · bundling several
approvals into one click.

---

## 4 · UI

### Reference designs reviewed

Nine images in `E:\UI` — dashboards, tasks, calendar. Eight of nine are phone
screens. The closest to the intended dashboard are `common/c1.png` (dark card,
72% ring, Total/Completed/Pending) and `Home screen or Dashboard/h5.png` (80%
donut, "Today's Schedule"). `h2.png` is the iOS Fitness ring pattern.

**Decision: mobile and desktop both designed properly**, not one collapsed into
the other.

### Shared components — built, mostly unused

`src/components/ui/` — Card, Button, Badge, StatTile, DataTable, form fields,
Modal, EmptyState, PageHeader.

`src/components/ops/use-operation.ts` is the important one. The block it replaces
was copy-pasted ~30 times and **handled success only** — a parked confirmation
and a refusal both looked like a button that did nothing. It now handles all
four outcomes, and keeps the server's opaque wording on a refusal rather than
explaining it.

Also done: the shell reads the session on the server, so role-gated nav no longer
flashes; and `Spine.readMany` replaces one database call per person.

**Currently used by one page** (`/hr/employees`). Everything else still has its
own inline markup — deliberately. Only new and rewritten screens get converted.

### Where the unreachable features belong

Four things are finished code with nothing calling them. Homes agreed:

| Feature | Home |
|---|---|
| **Day plan** | Dashboard — it *is* the dashboard |
| **Daily briefing** | Dashboard, via clock-in |
| **Meeting decisions** | Meetings page, on the meeting itself, after it ends |
| **Course decks** | Project (courses) section, next to the modules |

Note on decks: it produces a **slide outline, not a file**. The part that makes a
branded document was never finished and needs a document library and branding
assets.

### Known UI problems

- The mobile bottom bar has three real items and a centre button that links back
  to the dashboard
- Content has no bottom padding for that bar, so the last rows sit under it
- `/records` is a raw table browser over 162 record types, visible to everyone —
  an admin tool in an employee's menu
- An intern sees 20 menu items and can act on almost none of them
- "Projects" in the menu goes to `/courses`; nothing underneath was renamed
- There is no way to create a course anywhere in the application

---

## 5 · Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Does "money, people and leaving never automatic" stand? | **Keep it — decide after Phase 1**, once someone has actually used a confirmation screen. Nobody ever has. |
| 2 | Is a language layer worth 21 days and ~$50–90/month? | **Decide after week five.** Phases 0–4 deliver real autonomy with no model at all. |
| 3 | Does the daily digest ship first? | **Yes.** Two days. |
| 4 | One always-on instance or many? | **One.** Several parts assume a single process. Multi-instance costs ~2 extra weeks. |
| 5 | May names, pay and leave reasons reach an outside model? | **Decide before the language phase.** The region was chosen for Indian data residency. |
| 6 | Is `record.update` a real write path or a browsing tool? | **Browsing tool.** It was the source of the pay hole. |
| 7 | Where do courses come from? | Unresolved — nothing can create one, so the page will stay empty. |

---

## 6 · Not covered anywhere yet

- The assistant on a phone
- How it reaches you when you are not looking — no email, no push
- Any language but English
- Growth past ~50 people
- Recruitment, payroll and appraisal workflows (162 inert record types)
- Deployment — there is no deployment configuration in the repository at all

---

## 7 · Housekeeping

- **Rotate the database password** — the current one has been pasted in chat
- **Change the admin password** — currently `RealAdminPass2026`, also in chat
- A **second database for tests** — `npm run test:db` deletes every row, and
  pointed at the real one it would wipe it
- `docs/STATUS.md` marks all thirteen non-negotiables as holding. **Eight are
  false.** Correct it before anyone plans from it.
- `docs/BUILD-PLAN.md` marks background execution as done. Nothing exists.

### Related documents

| File | What |
|---|---|
| `docs/AGENTIC-PLAN.pdf` | The full 20-page plan — roles, every feature, order, risks, decisions |
| `docs/AGENTIC-PLAN.html` | Its source; edit and re-render with headless Chrome |
| `docs/DATABASE-SETUP.md` | How to create the database and what the tables are |
| `docs/CONTEXT.md` | The specification — 33 features, appendices A–E |
