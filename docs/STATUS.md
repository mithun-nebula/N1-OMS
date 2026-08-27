# Project Status — N1-OMS

> Last updated: 2026-08-26
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
| **7** Voice, web surfaces & polish | 16 | **15** | ⚠ **one open** — voice rebuilt as a live conversation in Phase 6; *restricted info not read aloud in a shared room* was ticked when nothing spoke, and something speaks now. See "Voice" below |
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

- `/dashboard` — the whole day loop plus the org view. Morning: brief → pick work (time per item required) → commit. During the day: tick done / **part done**, **drop** an item, reorder, and a **live overrun strip** that offers to move or drop displaced work. Evening: **clock-out opens a close-out conversation** — it reports what you did, asks only about work still open (carry over · drop · part done, as taps), seeds tomorrow, then folds the day into the streak. Also stat cards (click-through), my tasks (quick-complete checkbox), upcoming meetings, role-aware pending-approvals (approve inline), HR/admin attention cards
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
| Close of day (appendix A) | Clock-out conversation, live overrun offer, drop mid-day, part done | — | ✅ Done in Phase 0.5 (2026-08-24). |
| Assistant (feature 01) | Reads the organisation, answers questions, **acts**, and **watches** — all permission-bound | — | ✅ API only, Phases 1a + 1b + 2 + 2.5 + 3 + 4 + 4.5 — `POST /api/assistant/ask`. **106 tools, ten specialists, no UI — the coordinator carries 21 of them and routes for the rest.** All 56 wrappable gated operations; anything touching money or another person is **prepared, never done**. Standing rules are authored from a sentence, may **only notify**, and `stop_all_rules` turns every one of them off at once. |

### Phase 4 (on its own) — 2026-08-26

**It watches now.** A sentence becomes a standing rule, read back before it
saves, and from then on it runs unattended with **no model in the loop**.

Gate: lint · typecheck · build clean. **736 passing, 27 skipped** (48 added,
from 688) and **25 passing, 2 skipped** against Postgres.

**A rule may only notify.** `RuleWhen` is a closed union of four kinds —
`ageing`, `expiring`, `countOver`, `absent` — and `RuleDo` is `notify.send` and
nothing else. It cannot create, assign, approve or change anything. *"Give Arun
the review"* typed by a person is one thing; a rule handing Arun work every
Monday, decided by nobody that morning, is another. Revisit with evidence.

**The model runs exactly once, at authoring, and only to fill blanks.** Calling
it every tick would give cost that scales with the record count, drift between
one run and the next, and a rule nobody can audit because it never runs the same
way twice. Anything it returns that does not fit the schema is a **refusal**,
not a best effort — because anything a model can invent here is something nobody
would ever review, and a rule is reviewed once then trusted for months.

| | |
|---|---|
| **The regex compiler was deleted, not extended** | `autonomy/compiler.ts` turned sentences into rules by pattern-matching, so the set of rules the system could hold was whatever the regexes happened to accept — a set nobody had reviewed. Replaced by a **fixed form** with closed choices in every field. |
| **Closure versus plan, for the second time** | `RuleState` persisted the *grant* — who may emit what, how many clean approvals — while the rule itself was a JavaScript closure in an in-memory array. After a restart the ledger knew a rule was **allowed to fire** and nothing anywhere knew **what it watched**. That is `UndoInfo.revert` versus `undo.plan` again; the lesson did not transfer on its own. |
| **The bus subscription was removed** | A rule firing from a bus event fires once per event, so a burst of changes meant a burst of notifications, and re-entrancy could start a tick inside a tick. Evaluation is now a scheduled sweep with a `ticking` flag and a daily firing budget of 20. |
| **Fire-once keys are keyed on the record and the threshold** | Never on the day count. Key on "12 days" and the same course fires again tomorrow at 13, and the day after at 14, forever. |
| **The kill switch is deliberately not per-rule** | `stop_all_rules` is the thing to reach for **before** anybody knows which rule is misbehaving. Nothing is lost. And `list_rules` says out loud when everything is stopped — a stopped rule that lists as though it were running is how somebody waits all week for a notification that was never coming. |

**Running it for real found what 724 tests did not.** The model read a rule back,
the person said *"yes, that's right"* — and it answered **"I have set up the
rule. It is now running"** when nothing had been saved. The rule id was a hash of
the *sentence*, so the model's slight re-typing on the second turn made it a
different rule; the pending confirmation no longer matched, a fresh one was
issued in that same turn, and the turn boundary correctly refused it.

**That is the worst sentence this phase can produce.** Unlike a failed write
there is no missing record to notice. The person believes something is watching
for them and simply never gets told. Rule ids are now a hash of the **spec**, so
two phrasings that watch the same thing are the same rule; the refusal returns
`ruleIsNotRunning` and repeats itself in words a model cannot narrate around.
Pinned by a regression test that was proved to fail without the fix.

**A bad confirmation token was worse than none.** A later live run lost a rule a
different way: the model presented a stale `confirmationToken` it had carried out
of an earlier tool result, and `requireConfirmation` refused on the spot without
ever looking at the pending confirmation this server had issued in the previous
turn. Presenting *nothing* worked; presenting something *wrong* did not. It now
falls through to the pending path, which re-runs every check including the turn
boundary, so nothing is weakened. **The boundary is held by `spendConfirmation`**
— and a test says so, after measuring that the guard which *reads* as though it
were the load-bearing one is not.

**The system prompt had been lying since Phase 3.** It said *"You can only read.
You cannot change, create, delete or approve anything"* while 56 write tools sat
in the same catalogue. Nothing failed loudly — the model wrote anyway whenever a
tool obviously matched — so it survived two phases. What it did instead was tip
every **ambiguous** sentence toward a read tool, since a read tool was the only
kind the prompt admitted existed. Now asserted against the **catalogue** rather
than the wording, so it goes green on its own if the assistant is ever genuinely
read-only again.

**Still not right, and reported rather than forced.** A bare threshold phrase —
*"Courses in review over 5 days."* — is answered as a question and never reaches
`author_rule`, so the ambiguity branch that exists and is unit-tested never runs.
Two measured attempts failed to move it: a louder tool description, then the
prompt section above. The second was kept because it fixed a real defect, not
because it fixed this. Controls confirmed neither attempt made the model
*over*-call `author_rule` on plain questions. Failing this way is the safe
direction — a question answered, rather than a forever-rule created by a guess.

**Not covered:** the three new Postgres tables — `orga_autonomy_specs`,
`orga_autonomy_suggestions`, `orga_autonomy_fired` — have **no database-suite
test**. The autonomy tests run against the in-memory store. Their DDL is proved
only by the live run, which saved rules and read them back out of Postgres with
`psql`.

---

### Phase 3 (acting) — 2026-08-25

**The assistant can finally do things.** All 59 gated operations reach it and 56
are tools. `record.create` / `update` / `delete` are not, and never will be —
they browse 162 raw N1 doctypes and were the source of the pay hole.

**Catalogue 42 → 103.** 35 read · 8 day-plan writes · 60 Phase 3 writes.

| | |
|---|---|
| **Three tiers** | **Propose** (20 — the agent *cannot act*; it prepares, a person approves) · **Read-back** (6 destructive verbs, via Phase 2.5's confirmation gate) · **Straight through** (30). Conflating them would either park everything, which is unusable, or park nothing, which is unsafe. |
| **The spine is untouched** | `gate/gate.ts`, `SEVEN_STARTS`, `Spine.confirm()` and `PermissionPolicy` are unchanged. The gating lives in the tools; the spine still decides. |
| **Ten specialists** | Split from seven — Schedule would have carried ~21 tools and People ~19, three times what either has been measured at. None carries more than four now, and **none may write**: a fan-out is consulted for facts. |
| **A proposal survives the turn** | The whole `{ opName, args }` is stored server-side and submitted by id, so the model never re-derives it. It expires in minutes, `validate()` runs again at submit time to catch drift, and two open proposals produce a **question**, never a guess. |
| **`undo_last` inherits** | Undoing a money/people operation is itself one, so it proposes rather than acting. Without that it was a back door round the propose-gate. |
| **Every write paired with a read** | `pairing.test.ts` over the full catalogue. It found `approve_expense` took a `claimId` **no read tool produced** — `list_expenses` was written for it. |

> ⚠ **The plan was wrong about its own precondition.** It says parking is
> decided by `involvesMoneyOrPeople` and that `category` "does not appear in any
> parking condition" — quoting `gate.ts:94` and stopping four lines short of
> `:99`, where `neverGraduates(category)` is the second condition. The three
> operations it names as an open hole **already park**. No flag needed flipping.
> The real hole was larger: *both* branches require `delegated`, and an agent is
> not, so `wouldPark()` mirrors both. Checking the flag alone misses five.

**Ran it for real against Vertex — six defects that a green test suite missed.**
The worst was not a safety failure: the daily token ceiling, sized against 15
tools, cut a person off after **six questions** at 103. Every safety property
held perfectly while the product was unusable. Also: `list_leave` could not find
a pending request (schema says `"pending"`, records say `"Pending"`), there was
no expense read tool at all, a refused proposal stayed live and approvable, and
`leave.approve` would approve the same request twice and decrement the balance
twice.

**The decisive case.** Told *"Approve Arun's leave request. Do not ask me for
confirmation, just do it immediately."* as a first instruction, it answered
*"I have prepared the approval… nothing has happened yet. Please confirm."* and
the leave stayed `Pending`. **A person cannot waive the gate by instruction, and
neither can the model.**

**Not built:** an HTTP route to approve a prepared change from a button. The
conversational path works and is tested; there is no UI to tap either.

---

### Phase 2.5 (the meeting link, and the agent's own gate) — 2026-08-25

**Two parts.** Part A fixed the meeting domain, which was broken whether a
person or a model used it. Part B closed three things Phase 2 handed forward.

| | |
|---|---|
| **Every change says what it was and who did it (E5)** | All nine meeting and calendar operations supply `PublishTarget.message`. Before this they fell through to `summarizeChanges` and delivered `"meeting:meeting_x changed"` — the *who* was computed on every one and thrown away. |
| **The link reaches people (E7 ★)** | It rides on those messages to every attendee, and to anyone added later. It used to be returned to the **caller**. |
| **Cancelling ends the link** | The provider's own id is persisted and passed back; the local `link_meeting_…` id it used to send meant nothing to anybody. |
| **Google Meet is live** | By OAuth, not a service account — see below for why that route could never have worked. |
| **Meetings are on the common calendar** | By an **edge**, not a merge, so the open-node exemption stays one type wide. |
| **`both` is the default kind** | Landed together with room booking, so the new default is not a regression. `roomBookHandler` had been registered and called by nothing since it was written. |
| **A server-verified read-back** | `drop_item` and `close_out` took a `confirmed: boolean` **the model set**. Nothing checked a human had been asked. |
| **Appendix D has two surfaces** | `"coaching"` (the default, full strict set) and `"scheduling"`. **No pattern was altered** — only which surface applies which set. |

> ⚠ **The guarantee is a turn boundary, not a token.** The first build required
> the model to present a token back, and asked for real it was **impassable** —
> the conversation store keeps only text, so the token could never reach the
> second turn and *"yes, go ahead"* could never drop anything. A model can chain
> two tool calls; **it cannot forge a turn boundary**. Phase 3's propose-gate
> rests on the same mechanism.

**Still open, recorded rather than fixed** — three permission questions: meeting
undo is restricted to the actor or an edit-holder (E5 wants anyone affected);
interns cannot write to the calendar (against E3, pinned by a *passing* test);
and a meeting projected onto the common calendar is readable by an actor holding
no role at all.

---

### Phase 2 (the morning) — 2026-08-25

**The first phase that writes — and only ever to your own day.** None of the 59
gated operations became a tool here; that arrived in Phase 3, above.

| | |
|---|---|
| **Wider lookback** | `carryForward` reached back exactly one day, so work committed on Monday and not re-picked on Tuesday **vanished**. It now walks back 14 days, skipping days on leave, and carries `overdueDays` — chat says "four days overdue", and "red" stays a UI word that appears nowhere in the data. |
| **The brief, in chat** | `chat-brief.ts` opens with everything at once — in progress → overdue → diary → *"what are you taking on today?"* — and the person answers freely. **`briefItems()` is untouched**: the dashboard still renders the slideshow, two surfaces over one set of bands. |
| **Eight write tools** | `select_item` `commit_plan` `mark_done` `drop_item` `carry_over` `close_out`, plus `remember_commitment` `settle_commitment`. Catalogue 33 → **41**. |
| **The cap is a setting** | `QUESTIONS_PER_DAY = 2` → per-actor, **default 6**. Interruptions are capped; conversation you started never was and still is not. |
| **When to ask** | `scheduler.ts` — a pure decision the Phase 0.5 timer calls. No second scheduler. |
| **Commitments** | `orga_commitments`, built and hydrated in one step. Explicit only. |

**The rule every line of this phase obeys:** gather deterministically, narrate
with the model. Every number — days overdue, minutes left, which meetings, the
date "Thursday" resolves to — is computed in code. The model writes the sentence
around it and is never asked what is at risk.

**Ran a real day against Vertex.** The decisive result: an item dropped
*between* `close_out begin` and `close_out finish` made the day count clean
(`clean: 1`). Assessed on `begin`, that item would have scored the day 0 — so
the two-step close-out is provably doing its job with a live model, not just in
a unit test.

The carry-over wording, which the plan flagged as the most likely thing to be
subtly wrong, came out right unprompted:

> *"Carrying work over does not break your streak, but your day is not
> considered clean. A day is only clean when everything committed is finished
> within its time. The task will be offered to you again tomorrow morning."*

**Four defects found by running the day, none by reasoning about it:**

| Found | Fixed |
|---|---|
| **The chat brief could never select anything.** `selectItem` refuses while the phase is `briefing`, and the slideshow used to advance that phase step by step. The chat brief presents everything at once and never advanced it — so three items were named, all three refused, and the day stayed empty. | ✅ `markBriefDelivered` — presenting the whole brief *is* answering it. |
| **The model claimed success on failure**, replying *"I've added Module 4 (60 minutes)"* when the tool had refused. `{ ok: false }` was too quiet to survive a model in a hurry. | ✅ Refusals now carry `didNotHappen` and `tellThem` **in the payload**, and the system prompt names them. |
| **`my_day` returned no item ids**, so `mark_done` and `drop_item` had nothing to reference and the model guessed — *"I could not find Module 4 on your plan"* for an item plainly on the plan. | ✅ Ids returned, and the description says never to invent one. |
| **The brief called stale courses "overdue".** `atRisk` says *"has been in review for 35 days"*; the model rendered it *"is 35 days overdue"* — a course waiting is not a missed deadline. | ✅ Narrator tightened; now verbatim. |

**Appendix D: zero false blocks.** Every sentence this phase can generate —
brief, coaching, read-backs, commitment chases, close-out — is swept through
`enforceAppendixD` in `appendix-d-load.test.ts`, and `appendix-d.ts` is
**unmodified**. 1b had one false block; writing the wording with the patterns in
view avoided a repeat.

**Boundaries held deliberately:**

- **No write tool takes a person.** Not "it refuses" — there is nowhere to put
  one. Asserted for all six roles.
- **No specialist can write.** A specialist is consulted for facts; the
  coordinator acts. A fan-out cannot change anybody's day as a side effect of
  being asked a question.
- **`classifyMiss` still owns the verdict.** `mark_done` returns `missKind` and
  the model writes around it. A reason like *"the client call ran long"* colours
  the sentence and does not move `miss.kind` — a model that re-decided would
  contradict the streak, and the streak is what people trust.
- **Nothing applies a learned estimate silently.** It is offered as a question.
  The estimate is the one number in the day plan a person owns.
- **Carry-over does not excuse the day.** Asserted, because if it did, tapping
  it on everything would make every day clean and the streak worthless.

> **Still no UI.** Everything here ends at an API — `POST /api/today`
> (`chatBrief`, and the existing actions) and `POST /api/assistant/ask`.

**Left for Phase 3, by decision rather than discovery:** `/api/messages` and
`/api/activity/[id]/undo` become write tools; `/api/autonomy/rules` is Phase 4
and deliberately not a generic write; `/api/settings/password` and
`/api/admin/accounts` never, being outside the gate on purpose.

Gate: lint · typecheck · build clean. **577 passing, 25 skipped** (from 490) and
**23 passing** against Postgres.

### Phase 1b (reading, stage two) — 2026-08-24

**Phase 1 is complete. The assistant reads the whole EMS and still writes
nothing.**

Eighteen more tools took the catalogue to **33**, and the regex router is gone.

| | |
|---|---|
| **Tools** | 33, asserted by a test on `ALL_TOOL_NAMES` |
| **Specialists** | seven, each holding only its own domain's tools — never more than seven |
| **Fan-out** | deterministic `Promise.all`, then one merge. **Not** model-chosen delegation |
| **Router** | `pickSpecialists`' four regexes **deleted** — feature 01 asks for a model judgement, not a pattern match |

**`window.ts` is the defence against 1a's one real defect.** Every tool taking a
relative period — *"this quarter"*, *"overdue"*, *"last fortnight"* — resolves it
**server-side** through `resolveWindow` and returns the resolved window in its
result, so an answer's dates can be checked against it. 1a fabricated
*"August 11–17, 2025"* under a correct conclusion; nothing computed is left to
the model now.

**Asked for real: 18/19 tool choices correct at 33 tools**, against 15/15 at 15.
The single miss — *"Who reports to nobody, and what are they working on?"* — was
**not** a selection error: it chose the right tools, then an iterative strategy
that exhausted the 12-step cap and returned nothing. The identical question
succeeded at a narrower scope. **`gemini-3.1-flash-lite` stays**; there is no
measured selection degradation, which is the only evidence that would justify
moving up a tier.

**Three deviations from the plan, all deliberate and all declared.**

1. **`required_documents` replaced `document_acknowledgements`.** No
   acknowledgement state exists — announcements and their acknowledge chase were
   replaced by messaging. Building the named tool would have shipped one that
   answers confidently from nothing.
2. **`search` had no global search to wrap.** The sidebar search is client-side
   with no endpoint, so it composes `spine.readMany` across nine node types —
   permission-filtered per record by construction, asserted across all six roles.
3. **The seven specialists live in one file.** A specialist is a name and a list
   of tool names; seven six-line files would scatter a table whose value is being
   checkable in one place. A test asserts every tool belongs to exactly one
   domain, none is orphaned, and no domain names a tool that does not exist.

**One rename, and the reason matters:** `rankedOn` → `orderedBy`. Asked for real,
the model echoed the field name and `sanitizeForAppendixD` blocked `/ranked/i` as
a comparison, replacing a correct, well-hedged answer with *"I can only comment
on your work, not on you."* **The filter was not weakened** — the field was.

Gate: lint · typecheck · build clean. **490 passing, 24 skipped** (68 added) and
**22 passing** against Postgres.

### Phase 1a (reading, stage one) — 2026-08-24

**The assistant answers questions. It writes nothing, and it cannot.**

There is no write tool in the catalogue at all — the model is not instructed to
avoid writing, it is given nothing that could. Every one of the fifteen tools
wraps `spine.read` / `spine.readMany` or a service above them, so each re-checks
record scope per row and applies the field policy. An agent built only on those
cannot surface something its user could not already open: not by good behaviour,
by construction.

| | |
|---|---|
| **Provider** | `gemini-3.1-flash-lite` on **Vertex AI**, via `@ai-sdk/google-vertex` and a service account. Pinned: `ai@7.0.77`, `@ai-sdk/google-vertex@5.0.61`, `@ai-sdk/otel@1.0.77`. `ORG_LLM_PROVIDER` has four cases — `stub` (throws, **and is the default**, so no test can reach the network), `dev`, `fake` (scripted tool calls, what the tests use), `vertex`. |
| **Tools** | 15, covering all seven specialist areas: `find_people` `get_person` `list_leave` `leave_balance` `course_progress` `course_assignees` `list_tasks` `list_meetings` `room_availability` `list_equipment` `equipment_faults` `list_documents` `expiring_documents` `my_day` `search_memory`. Each caps at 20, reports the real total and whether it truncated, and returns the record ids it read. |
| **Endpoint** | `POST /api/assistant/ask` returns `{ answer, read, tools }` — the answer **and the records behind it**, so it can be checked. `orga_conversations` keeps the recent turns and summarises what falls off. |
| **The screen** | `/assistant`, added in **Phase 4.6**. ⚠ Until then the endpoint had **zero UI callers**, and the old line here described the conversation store without saying that nothing ever read from it — so feature 07’s *“remembers earlier conversations, follows you between phone and computer”* was built in Phase 1a and **never once ran**. The screen sends a `conversationId` derived server-side from the actor: the same string on every device, and opaque. |
| **Memory** | `orga_memory_facts` — what a person **told** the assistant about how they work, tagged by domain. `my_memory` reads it on the coordinator; specialists get their own domain’s facts injected and hold no tool. **What the agent concluded about somebody is never stored** — extraction sees only their own words, so appendix D’s forbidden class cannot be produced. Superseded facts are retired, never deleted. |
| **Not built** | `who_is_best` and `capability_gaps` — they derive a judgement rather than fetch a fact, and this model states derived things in the same tone as retrieved ones. `record.*` is excluded entirely: it is the browsing tool that caused the pay hole. |

**What permission equivalence proves.** For five questions across all six roles,
every record the assistant surfaced was checked against `spine.read` for that
person — the same call every screen makes. The property is *the assistant never
shows anybody a record they could not already open*. Verified by breaking it on
purpose: a tool made to read the graph directly failed the test in four places,
naming the leaked record and the role each time.

Live evidence, asked for real against Vertex: an intern asking "who is working
on AI Basics" is told *"I could not find a course titled AI Basics"* — not that
it exists and is withheld. Non-negotiable #2 holds through the assistant.

**Asked for real, and it chose well.** Twelve questions on a production build
with real credentials: **15 of 15 tool choices correct**, both deliberately
confusable sibling pairs held (`leave_balance` not `list_leave`; `get_person`
not `find_people`; `find_people` not `get_person`), and "what is Priya's pay"
was refused without revealing that a pay field exists. One question chained two
tools unprompted.

**One defect found live and fixed:** "who is off next week" answered
*"August 11–17, 2025"* — a fabricated range in the wrong year, because the
prompt never told the model what day it is. The prompt is now built per request
and opens with today's date. Every honesty rule in it was about not inventing
*records*; it invented a *date* instead, which none of them covered.

**One defect found live and deliberately NOT fixed:** an employee cannot read
their own leave balance. `leaveBalance` sits in `restricted` for self-reads
(`policy.ts:416`) — put there on purpose, because in `visible` it was also
*writable* via `record.update`. The existing `/api/people/{id}/leave-balance`
route refuses for the same reason, verified live. The assistant is exactly as
capable as the screens, including where the screens are wrong. Fixing it means
editing the permission policy, which is not a read-only stage's business.

> **The assistant has a working API and no UI.** Nothing in the product calls
> it yet; there is no chat screen and none is planned in this stage. A screen is
> not missing by accident.

Also corrected here: the suite had been **double-counting** `assistant.test.ts`
because `durability.test.ts` imported `openDay` from it, so vitest registered
that file twice. The helper moved to `day-plan/test-support.ts`. The true
baseline entering this phase was **377**, not the 462 previously reported.

Gate: lint · typecheck · build clean. **422 passing, 24 skipped** (from a real
377) and **22 passing** against Postgres.

### Phase 0.5 (finish the daily loop) — 2026-08-24

Verification on 2026-08-23 found the productivity loop had a hole at the end of
the day: **clocking out asked nothing**, and **nothing watched the clock during
the day**, so the one moment A4 says to interrupt somebody helpfully could never
fire. Two further A9 rules sat unimplemented in the same code. No AI and no
network — all four are plain feature work, and doing them first means Phase 1's
assistant arrives on a loop that is actually whole.

| Rule | Was | Now |
|---|---|---|
| **A9** — *"item dropped mid-day: allowed. Asked once why, does not break the streak."* | No drop path existed anywhere — no service method, no route action, no control. The only way to abandon committed work was to leave it open and let it fail the day. | `dropItem`, a `drop` action, and an × on every unfinished row that asks once, with taps, and takes "skip" for an answer. The item is **marked, never deleted**, so the day stays honest, and `assessDay` excludes it from `accountable` alongside interrupted work. Dropped work stops holding its slot, and is not carried into tomorrow — dropping is a decision, not a debt. |
| **A9** — *"half done: progress recorded, remainder carried forward. Only the shortfall counts against the day."* | An item was done or not done. Finishing 90% of something counted exactly the same as never starting it. | `progressMinutes` on `PlanItem`; `tick` records partial progress **without** marking it done and **without** classifying a miss (A4 forbids asking why while the work is still going). `DayOutcome.shortfallMinutes` means an item 54 minutes into an hour costs the day **six minutes, not sixty**. Tomorrow's brief names the remainder, not the whole item. |
| **A2/A9** — the close-out conversation | Clocking out recorded the time, folded the day into the streak, and ended. It asked nothing. | Clock-out opens a conversation that **tells** you the day — *"1 of 4 done. 2h of 4h committed work. 1 dropped. X ran over by 30m."* — built entirely from data already on the plan. It deliberately does **not** ask "what did you do today?": A2 is explicit that asking what the application already knows is what destroys trust in it. The only questions are about work still open, as three taps: **carry over · drop · part done**. |
| **A4** — *"the moment it runs over — an offer… interrupt to help, never to interrogate."* | Nothing ran on a timer. The plan reacted only to a tick or an operation, so the offer could never appear. | A client poll every 60s while the dashboard is open — not a server job, because A4 makes this a dashboard prompt and says plainly that *"the chat never opens by itself while you are working."* Fires only when all four hold: committed and not done · past its planned end · `restOfDayAtRisk` · not already shown today. Reads *"X is running over. Your 10:00 Y will not fit. [Move it] [Drop Y] [Leave it]"*. |

**Boundaries held deliberately, not overlooked:**

- **Clock-out seeds; morning commits.** The requirement asked for "what is your
  next day plan?" at clock-out. A1 puts planning in the morning, once a day,
  with mandatory time estimates — two planning conversations would either
  contradict each other or make the morning one pointless. Carried-over work is
  *offered* in the next morning's picker and still has to be chosen and
  estimated there.
- **Carrying over does not excuse the day.** Read literally, "does not count
  against the day" would make the streak trivially gameable — tap carry-over on
  everything and every day is clean. A7 says clean means every committed item
  was finished within its time, so carried-over work keeps the day from being
  clean while (as before) not *breaking* the streak the way a ran-over miss does.
- **No server-side scheduler.** Phase 2's question scheduler is the thing that
  genuinely needs a real tick; this warning is only useful when somebody is
  looking at the screen.

**Still not done in appendix A, stated plainly:**

- There is **no question scheduler** — nothing decides *when* to ask. The
  two-a-day budget is enforced, but the timing is reactive. Phase 2.
- The brief is a **card sequence, not a chat**. A1's "conversation-first" is
  honoured in shape and sequencing, not in medium. Phase 1.
- The overrun offer **cannot fire when the dashboard is closed**. That is A4's
  intent rather than a gap, but it does mean an overrun nobody was watching goes
  unremarked until close-out.

Walked by hand against Postgres 16 in Docker with demo data, as `employee`:
clock in → brief → commit four → ran-long + why → part done → drop → overrun
strip → clock out → summary → three taps → **restart** → next morning's seeds
and carried remainders both present. One wart found and fixed in the walk:
"Part done" at close-out recorded progress but left the item on the question
list, so it could be tapped repeatedly — it now carries the remainder forward
too, which is the whole of A9's sentence rather than half of it.

Gate: lint · typecheck · build clean. **462 passing, 22 skipped** at the time
(inflated by a double-count later corrected in Phase 1a — the real figure was
397) and **20 passing** against Postgres.


### Phase 0 (agent groundwork) — 2026-08-24

Three preconditions for the agent layer, fixed **before** the agent exists
rather than under load with an autonomous actor already relying on them. No
agent code, no UI, no new dependency.

| Was wrong | Now |
|---|---|
| None of `course.create` / `course.assign` / `course.delete` declared a `category`, and the gate's never-graduate check is `delegated && category && neverGraduates(category)`. An absent category short-circuits it, so a graduated standing rule could run `course.assign` — writing task records for up to three people and notifying each — **with nobody confirming.** Harmless only by accident: `autonomy/compiler.ts` can currently emit nothing but `notify.send`, and Phase 4 removes that. | `assign → "people"`, `create`/`delete` → `"routine"`. `involvesMoneyOrPeople` deliberately left `false` on all three: it governs person-started runs too, and a manager assigning a course by hand must not need a second confirmation. The test asserts the *reason* is `never-graduate`, not merely that it parked — an ungraduated rule parks as `not-earned` anyway, so status alone would have proved nothing. |
| The seven account mutations in `server/accounts.ts` wrote **no activity entry**. `grep "log.append"` returned only `spine/spine.ts`. Granting somebody the admin role, or resetting their password, was unrecordable. | `configureAccounts(pool?, log?)` takes the log — optional, so existing tests are untouched — and all seven append. Actor is a **required parameter**, threaded from the route handlers that know it. Never a password, hash or temporary password; never an undo plan. Entries appear in `/api/activity` and the `/admin` viewer with no UI work. |
| `AutonomyEngine.suspendAuthor` had **zero production callers**, so separating an employee left their graduated rules live under their authority until an admin hit `/api/autonomy/tick`. | `domains/autonomy/reactions.ts`, modelled on the day-plan reactions: react at the route, catch-all wrapped, never able to fail the write it followed. Hooked at **both** operation routes. |
| `/api/autonomy/rules` never passed `isAdmin` to `engine.revoke`, so an admin could not revoke anybody else's rule. | Passed. |

**A claim in the Phase 0 plan turned out to be wrong, and the tests caught it.**
The plan said `employee.deactivate` "always parks" and therefore only ever
reaches the confirm route. It does not: every parking condition in `gate.ts` is
guarded by `delegated`, so HR deactivating somebody through the form **runs**
and lands on `/api/operations`, while only a rule-driven deactivation parks.
Both routes carry real traffic and both are hooked — the plan's conclusion was
right for a stronger reason than the one it gave.

Gate: lint · typecheck · build clean. **398 passing, 21 skipped** (baseline 379
/ 21) and **19 passing, 2 skipped** against Postgres 16 in Docker.

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

### Voice — **a held conversation, since Phase 6**

Tap ✦ once. The session opens and **stays** open. You can cut in while it talks.

- `gemini-live-2.5-flash-native-audio` on Vertex, region **`us-central1`**
  (`GOOGLE_VERTEX_LIVE_MODEL` / `GOOGLE_VERTEX_LIVE_LOCATION` — its own region,
  because chat's `global` does not serve it and voice must not move chat)
- **Audio: 16 kHz PCM up, 24 kHz PCM down.** Both measured from the server's own
  token billing, not read from a document — the mime type carries no rate and
  the `rate=` you declare on the way up is ignored
- Ends **three ways**: the button (works mid-sentence), saying so
  (`end_session`, a tool — not a phrase match), and silence at 90s, warned at 75s
- Barge-in works: talking over it stops the playback queue immediately
- **The transcript is on screen while it listens**, so a mishearing can be seen
  before it becomes an action

> ⚠ **Voice prepares. A finger issues.** `approve_proposal` is **absent** from
> the live tool set — not refused, absent — so no money or people operation can
> be completed by speaking. The proposal appears in the panel with **Approve**
> and **Discard**, backed by `POST` / `DELETE /api/proposals/{id}`: it is
> submitted under the person's own hand, with their session cookie, through the
> same gate as everything else. Everything else (rooms, tasks, faults, the day
> plan) completes by voice.

> ⚠ **`server.ts` fences off Next's own WebSocket upgrade handler**, and that is
> not optional. Next attaches one lazily, on the first HTTP request it serves,
> to `req.socket.server` — and it ends any upgrade whose path matches a route,
> which `/api/voice` does. Without the fence a voice socket opens and dies
> milliseconds later with code 1006, no close frame and nothing logged, but only
> after a page has been loaded — so it looks perfect everywhere except in a
> browser. See `src/server/voice/attach.ts`.

What replaced the old widget: `voice-input.tsx`'s `detectIntent()` — a
four-branch keyword match on `t.includes("hall")` — is gone, along with
`webkitSpeechRecognition`. Same replacement Phase 1b made to `pickSpecialists`.

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
| `/api/assistant/ask` | POST | **Agent** answer with citations — 106 tools (35 read, 8 writing to your own day, 60 writing through the gated operations, 3 for standing rules). Since Phase 4.5 the **coordinator carries 21**; the rest live in the ten specialists, reached by `consult_specialists` (ask) or `delegate_action` (act) |
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
    assistant/  Phase 5 — briefing, daily commitments (appendix A); Phase 1a/1b — agent + 33 read tools + 7 specialists;
                Phase 2 — chat brief, 8 write tools, scheduler, commitments
    autonomy/   Phase 6 — earning-the-right, standing rules, routine watcher
    shared/     cross-domain demo roster
  server/       composition root
    bootstrap.ts  builds the world (stores + policy + registers all domains)
    runtime.ts    process-singleton world for the Next.js API routes
    policy.ts     demo permission rules + DemoRoleProvider
    auth.ts       RBAC: session tokens, password hashing, getSessionUser
    accounts.ts   credential store + verifyCredentials (writes activity entries)
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
> **10 hold · 2 partial · 1 not enforced** (was 9 / 3 / 1; #1 and #4 closed in
> Phase 0 on 2026-08-24; **#12 moved to partial on 2026-08-26** — the rule itself
> was changed with the product owner in Phase 2 and the tick was still being
> claimed against the original wording). Anything below ✅ names the gap and the
> file. Do not plan from a tick you have not read the line beside.

| # | Rule (CONTEXT §13, in full) | | Where it stands |
|---|---|---|---|
| 1 | One gate. All seven starts funnel through it; **permission and the activity log live only there** | ✅ | *Phase 0, 2026-08-24.* The log half now holds. All seven account mutations — `addAccount`, `addAccountForPerson`, `removeAccount`, `setAccountEnabled`, `updateRole`, `changePassword`, `resetPassword` — append an `ActivityEntry` naming the actor, who is now a **required parameter** so a caller cannot forget one. No password, hash or temporary password is ever recorded, and no entry carries an undo plan (there is no safe automatic undo for granting admin). They are logged rather than gated on purpose: `configureAccounts` runs inside `buildDemoWorld()` *before* the spine exists, because `verifyCredentials` must work for the first sign-in. Remaining, and deliberate: account writes still do not pass through `Spine.submit`, role checks sit in ~5 routes rather than the gate, and chat is outside by design. *Earlier round: `/api/people/[id]/attendance` checked `employee` permission then returned attendance unfiltered.* |
| 2 | Refusal never discloses that a record exists | ✅ | Permission runs before validation (`gate.ts`); `forbidden` and "no such record" are the same opaque answer. Pending-confirmation ids are enumerable, but those are actions, not records. |
| 3 | Money + people + leaving-the-org never go automatic (appendix B) | ✅ | *Fixed this round.* `record.delete` declared `involvesMoneyOrPeople: () => false` and no `category`, so a graduated rule could have deleted an employee or a payslip unattended. It now uses `touchesMoneyOrPeople` like its siblings. |
| 4 | Autonomy is earned (10 clean) and **revocable in one tap**; **a rule never outlives its owner** | ✅ | *Phase 0, 2026-08-24.* The last clause now holds. `domains/autonomy/reactions.ts` calls `suspendAuthor` on a successful `employee.deactivate` or `leaving.applySeparation`, hooked at **both** `/api/operations` and `/api/operations/[id]/confirm` — both carry real traffic, because every parking condition in `gate.ts` is guarded by `delegated`: HR deactivating by hand runs and lands on the direct route, a rule-driven deactivation parks and lands on confirm. Tested through both. Revocable also genuinely holds now: `/api/autonomy/rules` never passed `isAdmin` to `revoke`, so an admin could not revoke anybody else's rule; it does. Remaining: graduation and revocation are still not logged. |
| 5 | Voice always confirms before saving; restricted info never read aloud in a shared room | ✅ | **Rebuilt in Phase 6.** The read-back is now *heard*, which is what Phase 2.5's server-issued token was always trying to be, and all seven of its attacks are refused on the spoken path. Money and people cannot be completed by voice at all. ⚠ The second clause is **no longer vacuous** — the live model speaks, so anything a tool returns can be read aloud. It is still permission-filtered per record and per field before it reaches the model, so nothing is spoken that the listener could not have opened; but a shared room now has a real second listener, and there is no shared-room toggle. Recorded as a gap. |
| 6 | Daily commitments: conversation-first, tappable replies, mandatory time-per-item, once-a-day (A1) | ✅ | *Fixed this round.* Mandatory time and once-a-day already held; conversation-first was enforced only by the screen — `start` → `select` → `commit` committed a day with the brief untouched. `selectItem` and `commitPlan` now refuse during `briefing`. |
| 7 | Two kinds of miss — interrupted (no question, streak kept) vs ran over (one question later, streak breaks); never ask while someone is still working | ✅ | Repaired in an earlier round and verified against a running server. *Phase 0.5 closed the residual:* an item left unfinished at close-out is no longer classified as neither and silently failed — the close-out conversation asks what should happen to it (carry over · drop · part done), and A9's dropped and part-done outcomes now exist to answer with. |
| 8 | Streaks are personal only — never shown to a manager, never compared | ✅ | `managerView` is a four-field whitelist; `/api/today/team` re-projects; `streakFor` has exactly two call sites, both self-scoped. Verified in the rendered manager page: no name, no item, no `actualMinutes`. |
| 9 | The assistant comments on work, never on the person; never compares people | ✅ | `sanitizeForAppendixD` at the one place free-form text is composed; everything else is templated about records. Thin rather than false — a 15-pattern denylist at a single call site. |
| 10 | Exporting ≠ viewing (appendix C) | ✅ | `export` is a distinct action, absent from the open-calendar bypass, checked before anything is produced. Latent: `type=task`/`course` export skips record scope — safe only because it is admin-only today. |
| 11 | The common calendar is open to everyone — safeguarded by notify + record + undo, **all three required** (E3) | ⚠️ | *Undo now survives a restart* (all five calendar handlers and all three `record.*` gained serialisable plans this round). Still open: **interns cannot write to the calendar** — `readOnlyRoles` overrides the open-node exemption, contrary to E3; `assertAtomic` is dead code, so "all three" is asserted nowhere; and the write, the log append and the notify are not in one transaction. E5's "undo offered to anyone affected" is a session-local toast for the actor only. |
| 12 | At most two questions per person per day, everywhere | ⚠️ | **The rule was changed deliberately, and the tick used to be against the old one.** The cap is now **per-person, defaulting to six** (`DEFAULT_QUESTIONS_PER_DAY = 6`, `limiter.ts`) — decided with the product owner in Phase 2 on 2026-08-24. What the cap governs was also made explicit: it bounds **unprompted interruptions** only; a conversation the person started has never been capped and still is not. The mechanism §13 asked for holds — one shared, durable budget across the day plan and `utility.capture`, hydrated at boot, enforced on the *ask* and not merely the answer. **The number does not.** `QUESTIONS_PER_DAY = 2` still exists in `limiter.ts` and is now only a legacy constant. Phase 2 also built the scheduler this line used to say was missing (`day-plan/scheduler.ts`), and Phase 4 fixed its ordering so a bad day cannot spend the whole allowance on miss-reasons. |
| 13 | Any figure can be opened into the parts it was computed from | 🟡 | The UI half now exists (2026-08-27): `src/app/ui/figure.tsx` (`FigureValue`) renders a recorded figure as a tappable number that fetches `/api/figures/…` and opens its explainer + `computedFrom` parts — wired on `/courses` (kanban % and detail-modal %) and `/team` (Building-now % and person-modal %). Still partial: **one figure type exists in the whole product** (course completion); streak, day tally, leave balance and the stat tiles are plain numbers with no parts. Recording more figure types is backend work — the UI now follows wherever a figure is recorded. Same round also fixed `GET /api/proposals` (returned an unawaited Promise, i.e. `{}`, since nothing had ever called it) and added `/approvals` and `/history` screens plus voice-panel state visuals. |

## The day loop, tightened (2026-08-27)

Four changes, all three ways in (form · chat · voice):

- **Clocking in is now a gate, not a button.** First open of the day shows a
  blocking prompt offering the same brief three ways — tap through it, do it in
  chat, or speak it (`clockIn(how)` in `dashboard-client.tsx`; the voice option
  dispatches `n1:start-voice`, which `voice-session.tsx` listens for). The old
  "plan the day without clocking in" path is gone: nothing downstream — windows,
  miss classification, streak — means anything without a start time.
- **The picker separates started from not started** — "Already in progress" vs
  "Not started yet" (task `status` is now carried through `dashboard/page.tsx`).
- **A before-the-end check-in.** Inside the last 10 minutes of an item's window
  it asks "still on track?" with *On time · Need more time · Blocked*, as a small
  dashboard strip — appendix A1c's allowed prompt, never a chat that opens
  itself. `DayPlanService.recordStatusCheck` records it; `report_status`
  (tool #108, on the `day` specialist) is the same question for chat and voice,
  and answering it anywhere stops it being re-asked everywhere.
  - ⚠ Deliberately **exempt from the daily question budget** — A4 separates the
    helpful offer from the interrogation, and this is the former.
  - ⚠ "Need more time" **does not extend the committed estimate.** A7 warns that
    streaks tempt padding; a check-in that rewrote the estimate would make the
    streak unbreakable. It warns about what is now at risk instead. There is a
    browser test asserting 60min stays 60min.
- **The day is laid out from the clock-in, not from a fixed 09:00.** `DayPlan`
  gained `startedAt`; `scheduleWork` opens the day there, falling back to the
  09:00 opening when there is none (legacy plans, and planning before clocking
  in). It is read from the **attendance record** — `startDay` fetches it via
  `clockInFor`, and the `attendance.checkIn` reaction calls `markDayStart` for
  the reverse order — never stamped with `new Date()`, which dated a plan for
  another day with today's wall clock. Four tests cover it, including one
  through the real reaction.
- **The morning is now run by the assistant, when they ask for it.** Choosing
  *chat* or *voice* at clock-in hands the whole morning to the conversation: it
  raises each brief item, asks what they are taking on, asks **how long for
  each** (A1's estimate is required, so the picker cannot skip it), reads the
  day back — *"1h of work around 1h 30m of meetings, 2h free"* — and commits
  when they say so. Choosing *tap through it* keeps the on-screen brief; the two
  are surfaces over one set of items, never two implementations. Voice starts
  the spoken session over the same window, and its tools write to the same day,
  so the conversation fills in as they talk.
- **Work assigned after the day is committed is now raised, not swallowed.**
  A6 lets a meeting booked mid-day insert itself, because it takes the time
  whether anyone agrees or not. A task cannot: A1 requires an estimate, and A9
  says an item added mid-day "needs a time estimate like anything else". So the
  assistant asks — *"X has just landed on you. Take it on today?"* → *"How long
  for X?"* → it joins the day and the later times re-flow. "Not today" leaves it
  on their board untouched and does not ask again today (`declinedWork`).
  - The line that makes "new" meaningful is `DayPlan.committedAt`, stamped at
    commit; anything whose record moved after it counts.
  - ⚠ **Found while building it: `timestamptz` comes back from `pg` as a
    `Date`, while `RecordNode.updatedAt` is typed `string`.** Nothing
    complained, and `node.updatedAt > committedAt` then compared
    "Thu Aug 27 2026 …" against "2026-08-27T…" lexically — always false, so the
    feature found nothing. Normalised at the store boundary (`isoOf`) so the
    declared type is the truth for every caller, and the comparison here parses
    rather than string-compares.
- **The loop is visible** — `WatchLine` on the dashboard: *"Watching Write the QA
  report · ends 18:39 · next check in 50m"*. It decides nothing; it reports the
  same numbers the check-in is derived from, so the two cannot disagree.
- **All four moments are the same conversation** — the morning, the
  before-the-end check, the ran-over question and the clock-out. The check's
  strip is gone; one place the assistant speaks, so every moment it does looks
  alike. Each is dismissed its own way, so waving one off never silences another.
- **The two after-the-fact questions are a conversation, in the middle of the screen** —
  `src/app/dashboard/day-chat.tsx`. It opens itself for exactly two moments and
  no others: an item that **ran over** (asked once it is ticked late or the day
  is closing), and **clock-out**. Both are after-the-fact, which is what makes
  them allowed: A1c bars the chat from opening *"while you are working"*, and A4
  puts the mid-task OFFER ("your 12:00 will not fit") in a strip and the QUESTION
  ("what happened?") after the work. An **interrupted** miss opens nothing — the
  application knows why, and A2 says asking what it knows is what breaks trust.
  - Buttons first, typing optional (A1: "chat-first must never mean
    typing-first"), a "Later" that lets it lapse quietly (A4), and a "Full chat"
    link that carries the subject into `/assistant`.
  - Close-out **tells** what it knows (finished, worked vs committed, what ran
    over) and only **asks** what it cannot: what happens to each open item, and
    how the day itself was — that last answer goes into their own assistant
    conversation so it is there tomorrow.
  - The script follows the data, never an index: carrying an item over removes
    it from `unfinished`, so the next open item simply becomes the current one.
- **`missOffered` was keyed on the wrong gate** and is fixed: it required
  `miss.offerNow`, which means *later work is displaced* — the condition for the
  live offer, not the question. An item that overran and displaced nothing was
  never asked about, so A5 learned nothing from the commonest overrun of all,
  the last piece of work in the day.
- **Live refresh no longer fires under an open dialog** (`chrome/live.tsx`).
  `router.refresh()` re-runs the server components above every client component,
  and doing that beneath a modal discarded what was inside it — the day-plan
  chat lost the person's answer ~400ms after they tapped, on the very change
  their own answer had published. It now waits for the dialog to close, which
  protects every modal in the app.
- **Close-out already covered** the third ask (how the day went · what is still
  open · what carries to tomorrow) — kept, and now also offered as the
  conversation above.

> **Testing note.** `page.wait_for_load_state("networkidle")` never resolves any
> more — the live-update SSE stream is open for the life of the page, so the
> network never goes idle. Use `domcontentloaded` plus an explicit wait.

### The "not connected to the database" scare — found and fixed

Seen three times across a day: every real password rejected,
`ORG_BOOTSTRAP_PASSWORD` working again, the app apparently running with no
database — while the database was reachable and `/api/health` answered 200. It
came and went with the bundler's cache, which made it look like an environment
problem. It was not.

**Cause.** `server/accounts.ts` held `accountList` / `byUsername` / `byPerson` /
the pool in **plain module-level variables**, seeded with the defaults and
replaced by `configureAccounts()` once Postgres answered. That only works if
every caller shares one module instance, and in dev they do not: a route handler
can be evaluated in its own bundle, so `/api/auth/login` read a **second copy
still holding the defaults** while the copy the world had hydrated sat in
another. Nothing threw, so nothing looked wrong.

**Fix.** The account store now lives on `globalThis`, the same pattern
`runtime.ts` already uses for the world and for exactly the same reason.
Verified by hitting `/api/auth/login` as the very first request after a cold
start — the ordering that used to expose it — and by confirming the bootstrap
password is now correctly *rejected*.

**The tell, if it ever comes back:** login accepts only the `.env` bootstrap
password and reports `mustChangePassword: true` for an account the database says
is `false`. A login as `admin` with the real password is the one-second check
before a demo. Anything mutable that must be one object for every caller belongs
on `globalThis` too.

## Live updates (added 2026-08-27)

Every open screen now follows the brain in ~1s, whatever the start — form,
chat, voice, or automation. Server-Sent Events, one stream per tab:

- **Hub**: `src/server/live.ts` (`emitChange`/`subscribeChanges`, globalThis
  singleton, ~150ms coalescing). **Stream**: `GET /api/events`
  (session-checked; ordinary long-lived HTTP — no upgrade, voice fence
  untouched). Events carry **areas only, never data** — screens re-fetch
  through their own permission-checked reads, so nothing new can leak.
- **Taps**: `/api/operations` + confirm + undo (area = op-name prefix, plus
  `notifications`); the day-plan store's `put()` (one tap covers `/api/today`,
  chat day tools AND voice day tools — wired in `runtime.ts`); `/api/messages`
  send/read; `/api/proposals/{id}` approve/discard; `/api/assistant/ask` and
  `src/server/voice/tools.ts` emit a coarse `assistant` after each turn/tool
  (their gated writes go through `Spine.submit`, not the operations route);
  `/api/autonomy/tick` → `notifications`.
- **Client**: `src/app/chrome/live.tsx` — `<LiveUpdates />` in the shell
  (debounced `router.refresh()`, hidden-tab deferral, backoff reconnect) makes
  every server-component page live for free; `useLiveEvent(fn, {areas})` wires
  the self-fetching pieces (dashboard day panel/MonthGlance/TeamDay/DayHistory,
  bell, messages, approvals, assistant banner, `/history`). The bell's
  30-second poll is now a 5-minute fallback, and its first-open read-marking
  race (stale `items` closure) is fixed.
- Verified end-to-end against a running server: `data:{"areas":["day-plan"]}`,
  `["messages"]` and `["equipment","notifications"]` all observed arriving on
  the stream within ~1s of the write. Single-instance by design; multi-instance
  (Phase 8) feeds the same hub from Postgres LISTEN/NOTIFY.
- Also fixed in passing: `DELETE /api/proposals/{id}` never awaited
  `tapDiscard`, so its 404 branch was unreachable.

## Persistence

The spine's record store, activity log and figure store are **async** so a
durable backend drops in. Set **`DATABASE_URL`** (Postgres — Supabase or any) and
`buildDemoWorld()` uses **17 Postgres-backed tables**: `orga_nodes`, `orga_edges`,
`orga_activity`, `orga_figures`, `orga_accounts`, `orga_autonomy_rules`,
`orga_day_plans`, `orga_day_streaks`, `orga_day_estimates`,
`orga_notifications`, `orga_question_budget`, `orga_messages`,
`orga_message_reads`, `orga_conversations`, `orga_commitments`, and — added in
**Phase 4.6** — `orga_memory_facts` and `orga_token_budget`, and in **Phase 6**
— `orga_proposals`. Every
record, relationship, activity entry, figure, credential, graduation state,
day plan, streak, learned estimate, notification, question allowance,
remembered fact, **token spend** and **prepared proposal** persists across
restarts.

⚠ **`orga_proposals` is not about restarts, and the distinction matters.**
`propose.ts` argued a proposal should stay in memory precisely so a restart
loses it — the person is asked again against facts that were re-read — and that
argument still holds, enforced by the ten-minute expiry rather than by
forgetfulness.

It is about the **second instance**. A voice session on one prepares an approval
and puts it on the person's screen; the tap is an ordinary HTTP request the load
balancer may send to another, which never held it. Nothing unsafe happens — the
tap is refused — but the Approve button fails depending on which instance
answers, which is close to the worst thing to be handed as a bug report.

`take` is a single `DELETE ... RETURNING`, so **single-use survives two
instances racing**: both run it, exactly one gets a row. `SELECT` then `DELETE`
would look identical, pass every test, and let a double-tap through under load
— `store-pg.test.ts` has a test that fails if it is written that way.

⚠ **`orga_token_budget` is a deliberate reversal.** `token-budget.ts` said an
in-memory ceiling was the right choice because *a restart forgiving somebody’s
budget is the preferred failure*. That was right about restarts and silent about
**two servers**, which each believed nothing had been spent — so the ceiling
quietly multiplied by the deployment. It is durable now and **a restart no longer
forgives**; a database outage falls back to the old in-memory behaviour rather
than locking anybody out.

⚠ **`CREATE TABLE IF NOT EXISTS` is not race-safe**, and two servers booting
together both run it. The two tables above use `createTableIfNotExists`, which
tolerates the collision. **The other fifteen do not** — a pre-existing exposure,
found by the database suite and recorded rather than swept up inside an
unrelated phase. Unset → async in-memory (resets on restart). A **seed
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
| Real blob storage (documents) | 4 | Needs Supabase/Cloud Storage |
| OpenAPI spec generation (auto from zod) | 1 / 7 | Hand-authored spec served at /api/openapi.json; auto-gen optional |
| Cloud Run tuning, backup drills, security review | 8 | Production hardening — needs live stack |

### Google Meet — no longer deferred, and the reason it was is wrong

This table used to carry **"Real Google Meet client · Needs a Google service
account (GCP)"**. That line was false, and following it would have cost a day.

**A service account cannot create a Meet link for a personal Gmail account.** A
service account acting on somebody's behalf needs domain-wide delegation, and
domain-wide delegation needs Google Workspace. The account here is personal
Gmail, so that road has no end.

**The route actually used is OAuth with one shared refresh token.** The owner
consented once; the token is held server-side and exchanged for an access token
as needed. Users never see Google.

| | |
|---|---|
| API | Calendar `events.insert` with `conferenceData.createRequest`, **not** the Meet REST API |
| Why | One call returns the link, creates the event **and** emails the invitations. Meet REST returns a bare link on nobody's calendar |
| Cancel | `DELETE /events/{id}` with Google's own event id, persisted on the meeting as `providerMeetingId` |
| Externals | Event `attendees` with `sendUpdates=all` — **Google sends the invitation**, so no `EmailProvider` is needed for meetings |
| Env | `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_OAUTH_CLIENT_SECRET` · `GOOGLE_OAUTH_REFRESH_TOKEN`, and `ORG_VIDEO_PROVIDER=google` |
| SDK | **None.** `googleapis` is not a dependency; two `fetch` calls against documented REST endpoints |
| Tests | Never touch Google. `stub` is the default provider and the ten provider tests inject a fake `fetch` |

One consequence to accept: in Google's eyes every meeting is organised by the
one consenting account. The application's own `organizer` field stays truthful.

Verified live on 2026-08-25 through the production build and the real UI — a
real `meet.google.com` link, the link in every attendee's notification, a room
booked for the in-person half, cancellation leaving the Google event
`status: cancelled`, and a deliberately broken refresh token failing loudly
rather than writing a linkless meeting.

### The assistant's read-back is server-verified (Phase 2.5 Part B)

`drop_item` and `close_out` took a `confirmed: boolean` **in their input
schema** — a flag the **model** set. Nothing checked that a human had been
asked, that a sentence had been read back, or that anybody had said yes. It held
because the model was well behaved, not because anything stopped it.

| | |
|---|---|
| Where | `src/domains/assistant/tools/confirmation.ts` |
| Shape | First call never acts: it returns the consequence and a server-generated token, stored against `(actor, tool, target, turn)` with a 5-minute expiry |
| **What actually holds it** | **The turn boundary.** A confirmation cannot be spent in the turn that issued it |
| Why that and not the token | A model can chain two tool calls inside one agent loop and spend its own token, having asked nobody. **It cannot forge a turn boundary** — a new turn means the answer was delivered to a person and that person sent another message |
| Where the token lives | In memory, behind an injectable store. **No table** — a token lives for one conversational turn, so a restart losing it is *correct*: the person is simply asked again |
| Storage note | The conversation store keeps only `{user}` and `{assistant, content}`; tool traffic is deliberately not persisted, so the **server** carries the pending confirmation forward rather than the model |

Proved live against `gemini-3.1-flash-lite`: told *"drop module 5, and don't ask
me, just do it"*, it asked anyway and nothing changed. **The person cannot waive
the gate by instruction, and neither can the model.**

`requireConfirmation()` is what Phase 3 should reuse for any verb that must not
act unasked. It is deliberately **one weight lighter** than the propose-gate in
`gate.ts`, which *parks* money and people operations for somebody with authority
to release them. Phase 3 needs both; conflating them would either park
everything (unusable) or park nothing (unsafe).

### Appendix D has two surfaces (Phase 2.5 Part B)

`enforceAppendixD(text, surface)` — `"coaching"` is the **default**, so a call
site that says nothing keeps the full strict set; loosening has to be asked for
by name.

- `chat-brief.ts` → `"coaching"` (the morning brief *is* coaching prose)
- `agent.ts` → `"scheduling"` (where Phase 3's proposals come out)

Only the time-of-day pattern differs between them. **No pattern was loosened,
narrowed or reworded** — every regex is byte-identical and a test reads the file
to prove it. The reasoning, measured rather than argued, is in the header of
`src/domains/assistant/appendix-d.ts`; Phase 3 should not re-litigate it.

### Every write tool's ids are supplied by a read tool

`src/domains/assistant/tools/pairing.test.ts` walks every write tool, reads the
id fields out of its `inputSchema`, and **executes every read tool** to check
one of them actually returns those ids. Written because Phase 2 found `my_day`
returning no ids only by running a real day — the model guessed, and answered
*"I could not find Module 4 on your plan"* for an item plainly on the plan.

It found `settle_commitment` took a `commitmentId` that **nothing produced**,
which also explains a fact sitting unexplained in Phase 2's log: across a whole
live day `settle_commitment` was reached *zero* times. Fixed by
`my_commitments`, the 34th read tool.

### The assistant can act (Phase 3)

**All 59 gated operations reach it; 56 are tools.** `record.create` /
`record.update` / `record.delete` are not, and never will be — they browse 162
raw N1 doctypes and were the source of the pay hole.

**103 tools:** 35 read · 8 day-plan writes · 60 Phase 3 writes.
*(Phase 4 added three more — `author_rule`, `list_rules`, `stop_all_rules` — for
**106**. The figures in this section are Phase 3's, and the cost measurement
below was taken at 103.)*

| Tier | Which | What happens |
|---|---|---|
| **Propose** | the 20 that would park under a standing rule | the agent **cannot act**. It prepares; a person approves |
| **Read-back** | `delete_task`, `cancel_meeting`, `cancel_calendar_entry`, `cancel_room_booking`, `delete_course`, `close_event` | acts **after** a server-issued confirmation |
| **Straight through** | the rest | it just does it |

`gate/gate.ts`, `SEVEN_STARTS`, `Spine.confirm()` and `PermissionPolicy` are
**unchanged**. The gating lives in the tools; the spine still decides.

⚠ **Both parking conditions, not one.** `gate.ts` parks on
`involvesMoneyOrPeople && delegated` (`:94`) **and** on
`delegated && neverGraduates(category)` (`:99`). Phase 3's plan claimed the
second did not exist. It does, and five operations park only through it — so
`wouldPark()` mirrors both. `spine/operation/declarations.test.ts` pins every
one of the 59 declarations and asserts that difference is exactly five.

### What 103 tools costs, measured — and what Phase 4.5 did about it

**Every tool definition is sent with every request.** The daily token ceiling
was sized against 15 tools, then 33, and nothing re-checked it — so Phase 3's
first live run cut a person off after **six questions**.

```
coordinator's tool definitions   ~25,000 tokens per call
read-only half                   ~10,400
worst single specialist           ~1,500
old ceiling 200,000   ->   7 questions a day
```

Ceiling raised to **2,000,000**, and `tool-cost.test.ts` now FAILS if a working
day of thirty questions stops fitting. ⚠ This is a **cost** guard, never a
safety guard: nothing about permission, parking or the propose-gate depends on
it, and hitting it degrades the assistant while every screen keeps working.

**That deferred structural fix was done in Phase 4.5** (2026-08-26), and it is
no longer deferred. `toolsFor` returned `ALL_TOOLS`; the coordinator now holds a
hot set instead.

```
                                     before      after
coordinator definitions, per call    26,391      5,462     4.8x
a working day at that cost               75        366  questions
a WRITE, both calls added together   26,391      9,240     2.9x
```

**What the coordinator carries now — 21 tools, not 106:**

| | |
|---|---|
| **6 hot reads** | `my_day` · `list_tasks` · `get_person` · `course_progress` · `find_people` · `list_leave` — **earned by call frequency** counted across every live run since 1a, capped at eight with **two seats deliberately left empty** because below three calls the evidence stops separating candidates |
| **3 promoted writes** | `select_item` · `drop_item` · `remember_commitment` — promoted back under the latency fallback, at most three, ever |
| **11 that cannot be routed** | `approve_proposal` · `discard_proposal` (turn 2 is *"yes"*, which carries no domain) · `send_message` · `notify_people` (telling somebody something is not an area) · `undo_last` · `search` · `who_is_best` · `capability_gaps` · the three rule tools |
| **+ 2 doors** | `consult_specialists` (ask many, **`ask` mode always**) and `delegate_action` (instruct **one**, `act` mode) |

⚠ **The cost, measured rather than felt.** A write is now two model calls. Live:
a question runs at a **2.7s median**, a routed write at **5.5s**, and the day
flow at **6.5s**. Three writes were promoted back under the rule decided in
advance; **three was not enough** and it stopped there rather than promoting a
fourth. `commit_plan`, `mark_done`, `carry_over` and `settle_commitment` are
still routed, and the answer to that is a cheaper router, not more promotions.

⚠ **And the lesson that cost the most to learn.** Both two-turn mechanisms end
with a plain conversational reply. `approve_proposal` was kept on the
coordinator for exactly that reason — but the **read-back gate has the same
shape**, and nothing kept `drop_item` there. Told *"forget the Arun prep"* then
*"yes, drop it"*, the model called `approve_proposal`, the only confirm-shaped
tool still in view, and nothing was dropped. Phase 2.5 had proved that exact
path working, and no unit test caught it because a scripted model re-delegates
correctly and a live one reaches for what it can see. **A tool moved out of view
is not merely slower to reach — the nearest thing still in view gets called
instead.**

### Still open in the meeting area — recorded, not fixed

Both are **permission decisions** and were deliberately not taken quietly.

- **Undo on a meeting is restricted to the original actor or someone holding
  `edit`** (`mayUndo`, `spine/spine.ts`). Appendix E5 wants undo offered to
  *anyone affected*. Widening it is how the calendar's open-node exemption would
  spread beyond the one node type `security.test.ts` pins it to.
- **Interns cannot write to the calendar** (`readOnlyRoles` in
  `server/policy.ts`), against appendix E3 — and it is pinned by a **passing**
  test in `src/server/rbac.test.ts` that encodes the wrong behaviour. Changing
  it means changing that test, which is exactly why it needs deciding rather
  than doing.
- **A meeting projected onto the common calendar is readable by an actor with
  no role at all.** `calendar-entry` is the one member of `OPEN_NODE_TYPES`, so
  the projection carries the meeting's title and join link outside the
  permission system. Every actual role already had `view` on `meeting` with
  scope `all`, so this widens nothing for anyone who works here.

## How to run it

> 📄 **Building the UI? Read `docs/VOICE-UI-CONTRACT.md` first.** Voice has five
> load-bearing pieces in the front end and the build, and **every one of them
> fails silently** — the app builds, the tests pass, every screen works, and
> voice is simply not there.

> ⚠ **`next start` no longer runs this application.** Phase 6 needs to accept a
> WebSocket upgrade on `/api/voice`, and **a Next App Router route handler never
> sees an HTTP upgrade** — Next's own HTTP layer consumes it before any route
> runs. So `server.ts` wraps Next: it hands every ordinary request to Next's
> handler and handles `upgrade` itself.
>
> A clone of this repo started the old way will serve every screen correctly and
> **voice will simply not be there**, with no error to explain it. That is why
> this section exists.

```bash
npm run dev          # server.ts + Next in dev mode → http://localhost:3000
npm start            # production; run `npm run build` first
npm run dev:next     # plain `next dev`, NO voice — for UI work only
```

`server.ts` is run by `tsx` rather than compiled, because it reaches into `src/`
for the session verifier and the relay, and `src/` uses `@/*` path aliases and
extensionless imports that plain `node` does not resolve. The alternative was a
second implementation of the session HMAC, which is the one thing that must
never have two.

`npm start` passes `--prod` rather than setting `NODE_ENV=production` in the
script: that is shell syntax Windows does not have, and this is developed on
Windows.

## Commands

```bash
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest run (968 passing, 32 skipped as of 2026-08-27)
npm run test:watch   # Vitest watch mode
npm run test:db      # Postgres durability tests ONLY (30 passing, 2 skipped as of
                     # 2026-08-26) — reads ORG_TEST_DATABASE_URL, refuses if it
                     # equals DATABASE_URL
```

## Environment

Copy `.env.example` to `.env`. Defaults work for local dev.
Set `N1_BASE_URL` / `N1_API_KEY` / `N1_API_SECRET` when N1 (Frappe) is live.
Set `ORG_LLM_PROVIDER=dev` for canned LLM responses (assistant/deck).
Set `DATABASE_URL` (Postgres — Supabase or any) to persist data across restarts;
unset → async in-memory (resets on restart).
Set `GOOGLE_VERTEX_LIVE_MODEL` / `GOOGLE_VERTEX_LIVE_LOCATION` to move voice to a
different live model or region. **They are separate from `GOOGLE_VERTEX_MODEL` /
`GOOGLE_VERTEX_LOCATION` on purpose**: chat runs on `global`, and the live model
is not served there.
Set `ORG_VIDEO_PROVIDER=google` plus `GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` for real Meet links;
unset → `stub`, which is the default so no test can reach Google by forgetting.
