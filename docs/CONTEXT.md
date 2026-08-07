# CONTEXT — Organization A application (single source of truth)

> One file that consolidates **every** document in this folder so the whole
> project can be understood without opening anything else.
>
> **Sources consolidated** (all read in full):
> - `Application-Build-Scope.pdf` — 15 pages, the authoritative spec (extracted to text).
> - `System-Architecture.md` — the shape / the gate / the rules.
> - `System-Flow-Branching.html` — the branching flow diagram (capabilities + decisions).
> - `Mock-UI-Web.html` + `Mock-UI-Web/*.png` — 4 desktop screens.
> - `Mock-UI-Mobile.html` + `Mock-UI/*.png` — 4 phone screens.
> - `Demo-Today-Screen.html` — working interactive demo of the morning brief → dashboard.
> - `open-source-ems-erp-options.md` — build-vs-buy research.
>
> **Reading order of this file:** what it is → the core idea → the rules → every feature
> → the appendix rules (A–E, the real detail) → the screens → the flow → open decisions →
> build-vs-buy → discrepancies & gotchas.

---

## 0. WHAT THIS PROJECT IS

Organization A is **a training/course-publishing organization** building an in-house
application that runs its everyday work: employee records, leave, building courses,
booking rooms, meetings, events, documents and announcements.

It is **not a generic HRMS**. The differentiator is an **assistant-first, operation-based**
design: almost everything happens through a conversational assistant that funnels every
action — typed, spoken, or from a form — through **one gate**, records it, and publishes it.

The deliverables in this folder are **design/spec artefacts only**. There is no code yet.

**The spec itself stays provider-agnostic** — nothing in sections 1–8, 10 or 13 depends on a
language, framework or vendor. The **build/implementation decisions** (stack, hosting, OSS
choice) have now been made and are recorded in **`BUILD-PLAN.md`**; the resolved vs still-open
ones are summarised in §9 below.

---

## 1. THE ONE CORE IDEA (the whole architecture follows from this)

**Every capability is the same kind of thing: an operation.** Booking a room is an
operation; approving leave is an operation; sending a reminder is an operation. What
differs is only *who starts it*.

### Seven ways an operation can start
**A person starts it (3 ways):**
1. filling in a form
2. typing it (a message)
3. saying it out loud (voice)

**The application starts it itself (4 ways):**
4. a schedule fires
5. a record changed
6. a standing rule matches
7. it noticed a routine someone repeats by hand

**All seven go through the same gate.** This single decision shapes everything else.

### The shape (narrows twice)

```
seven ways it can start        ← wide
        ↓
    THE GATE                   ← narrow
        ↓
people · course · workplace    ← wide (the actual work)
        ↓
record it and publish it       ← narrow
        ↓
what it sets off · how it reaches you
```

The two narrow points are the whole argument:
- **Nothing touches a record without passing the gate.**
- **Nothing changes without being recorded and published.**

Because everything funnels through those two points, **permission checking and the
activity log only have to be built once** — not separately for forms, voice, the
assistant, and scheduled jobs.

---

## 2. THE PARTS

| Part | What it is |
|---|---|
| **The surfaces** | Web + mobile. Forms, typing and voice all produce the same result because they all call the same operation. |
| **The assistant** | Not one assistant doing everything. A **coordinator** splits a request across **specialists** (people, courses, rooms, documents, etc.) and returns one answer. Each person's assistant knows only that person's work. |
| **The gate** | Every operation passes six checks (see §3). |
| **The services** | Six areas that own the records: people & employment; skills & capacity; course work; workplace; meetings & events; documents & notices. |
| **The record** | One connected store — people, courses, rooms, equipment, documents and decisions all linked, so one question can cross all of them. Keeps history over time; every figure keeps the parts it was calculated from. |
| **The background side** | Standing rules, the scheduler, the daily briefing, the routine watcher, and the question scheduler (at most two short questions per person per day). |

---

## 3. THE GATE — six checks every operation passes

1. Are the arguments valid? *(no → say exactly what is missing)*
2. Do this person's role, record access and field access allow it? *(no → refuse **without revealing that the record exists**)*
3. Did a person ask for this just now? *(yes → it runs under their own hand)*
4. Does it involve money or people? *(yes → **it always asks. Never automatic.**)*
5. Has this rule earned the right to act alone? *(no → prepare it, then ask)*
6. Then it runs.

---

## 4. THE RULES THAT ALWAYS HOLD

| Rule | What it means |
|---|---|
| **Permission is checked at the gate** | Not in the screen, not by the assistant. So the assistant cannot reveal what its user could not already open. |
| **Refusal does not disclose** | If someone may not see a record, the reply does not hint that it exists. |
| **Money and people always ask** | These never become automatic, however many times they are approved. |
| **Autonomy is earned, and revocable** | A rule acts alone only after repeatedly getting it right. It runs under its author's authority, capped at that person's permissions right now. |
| **Everything is recorded** | Who did it, under whose authority, what changed, and how to undo it — including anything the application did by itself. |
| **Voice confirms before saving** | Spoken instructions are read back first. Restricted information is never read aloud in a shared room. |

---

## 5. THE FEATURES (canonical list from the PDF)

The PDF `Application-Build-Scope.pdf` is authoritative. It lists **33 numbered features
(01–33)** grouped into five bands. (See §12 for the "32 vs 33" numbering note.)

Each feature below has: a one-line description, its ✦ example, and its place in the flow.

### THE FOUNDATION

**01 · Team of specialist assistants**
Not one assistant — several specialists, each responsible for one area, with a coordinator dividing work between them.
✦ "Who can build a course on spreadsheet automation?" → one specialist checks subject knowledge, another checks availability, a third checks workload — one answer.

**02 · One connected record**
Everything in one place — people, courses, rooms, equipment, documents — instead of separate files that can't see each other.
✦ "Which courses has Priya written, and what is she building now?" → answered in one go because the records are linked.

**03 · Three ways to do everything**
Every task can be done by filling a form, typing a message, or speaking. All three do exactly the same thing.
✦ Book a room by tapping the calendar, typing "book the hall Tuesday at 2", or saying it — same booking, same approval, same record.

**04 · Roles and permissions**
Controls what each person can see/do — by role, by which records concern them, and down to individual fields.
✦ A course writer opens an employee record and sees role + contact, but not pay. The assistant won't reveal it either. *(Detail: appendix C)*

**05 · Complete activity record**
A permanent record of every action — who, when, how to undo — including anything the app did by itself.
✦ "Who changed this course's due date?" → shows person, date/time, offers to put it back.

**06 · Figures you can question**
Any number shown anywhere can be opened up to see exactly how it was worked out.
✦ Course summary says 60% done → tap to see which modules finished, which not, when each moved.

**07 · Personal assistant**
Your own assistant, not a shared company one. It answers from where you stand (your work, your team, what you can see), remembers earlier conversations, follows you between phone and computer, and points out problems with your own workload before they bite.
✦ "What's on me today?" → your deadlines, approvals, what you're waiting on. Nothing belonging to anyone else. ✦ "You have committed 8 hours of work to a day that already has 3 hours of meetings." *(Detail: appendix D)*

### HOW IT ACTS ON ITS OWN

**08 · Standing instructions**
Describe a rule once in ordinary words; it's followed forever without being asked again.
✦ "if a course sits in review more than five days, tell me" → every course checked every day, indefinitely.

**09 · Earning the right to act alone**
Anything new starts supervised and asks every time. Only acts by itself after repeatedly getting it right. Money/people/leaving-the-org actions **never** graduate.
✦ "I've drafted this reminder ten times and you approved every one unchanged. Shall I send them myself from now on?" *(Detail: appendix B)*

**10 · Suggestions from watching**
It notices routines people repeat by hand and offers to take them over. **Nothing is automated unless you agree.**
✦ "Every Monday you check which courses are overdue. Would you like me to send that list at 9am instead?"

**11 · Asking at the right moment**
Rather than hoping people fill in forms, it asks one short question at the moment the answer exists — **never more than twice a day.**
✦ End of day: "Was the air conditioning on today?" — "Yes, 9 to 6." Recorded in four seconds.

### EVERYDAY USE

**12 · Speaking to it**
Speak instead of typing, on computer or phone. Confirms before saving anything; never reads private information aloud in a shared room.
✦ Walking out of a room: "the projector in Hall 2 isn't working" → repeats back to confirm, then logs the fault.

**13 · Daily briefing**
A short summary per person — what changed, what needs them today, what is at risk. This is where most of what it notices gets delivered.
✦ "The AI for Presentations course is a day behind. Priya's leave needs your approval. Six people haven't acknowledged the new policy."

**14 · Daily commitments**
Turns the briefing into a plan. Each morning the assistant walks you through the brief as a conversation, then asks what you're doing today and how long each takes. The day appears on your dashboard, reorderable, tickable. If something runs over, it asks why — but only when it doesn't already know.
✦ "Which of these are you doing today?" → tap three, tap a time for each, no typing. At six o'clock: "the module took longer than the two hours you planned — what happened?" *(Detail: appendix A)*

**15 · Technology and AI news**
A panel on the home screen with current AI/tech news, filtered to the subjects taught here. **The same for everyone** (the one non-personal part of the screen).
✦ "A major update to a tool you teach was released this week. Your course covering it was last revised eight months ago."

### THE EMPLOYEE SIDE

**16 · Employee records and directory**
Staff records, documents, reporting lines, searchable directory. Sensitive fields restricted.
✦ "Three people have no signed contract on file. Shall I chase them?"

**17 · Leave and attendance**
Leave requests, entitlement balances, approvals, attendance — by form, message or voice.
✦ "Taking Friday off." → checks nothing clashes, sends to the right person for approval.

**18 · Joining and leaving**
A guided process for a new person's first weeks and a departing person's handover — with **owners for each step** rather than a checklist nobody opens.
✦ "Meena left last month. Two laptops are still assigned to her, and one course still lists her as owner."

**19 · Course team progress**
Knows what the team is building, taken from the work itself rather than status forms or status meetings.
✦ "How is the AI for Data Analysis course going?" — "Almost done, just the tasks left." That one line updates the whole team picture.

**20 · Who is best for the work**
Answers who is best suited to a piece of work and shows why — based on what people have **actually produced**, not what they claim.
✦ "Arun. He wrote the related course and reviewed two others, and has the lightest load this week."

**21 · Capability gaps**
Compares what the team can do against what the course catalogue needs.
✦ "Only one person can build courses on data analysis. If they leave, that subject stops."

**22 · Organizational memory**
Remembers what was decided and why, so knowledge isn't lost when someone is away or leaves.
✦ A new joiner asks "why do we shadow someone for two weeks?" → it finds the decision, the reason given at the time, and who made it — even though nobody involved is still on the team.

### COURSE WORK

**23 · Course building pipeline**
Manages a course from first outline to publication, with clear stages, owners and full version history.
✦ "The AI for Presentations course has been waiting for review for eight days."

**24 · Presentations and documents**
Anyone can ask for a presentation or document on any subject and get a finished draft in the organization's own format.
✦ "Make a deck introducing spreadsheet automation." → fourteen slides, correctly formatted and branded, ready to edit.

### THE WORKPLACE

**25 · Room and hall booking**
Books halls/rooms, checks the space actually suits, and **sorts out clashes instead of simply refusing.**
✦ You book the hall at 3pm but it's taken. "Move the other booking to the small room?" — once you agree, they are told.

**26 · Meetings and video calls**
Sets up meetings from one instruction — finds a time everyone is free, books the room if in person, creates the video link if online, sends everything in one action. In person, online, or both. Meetings appear in each attendee's day alongside their work; displaced work is rescheduled automatically.
✦ "Set up a review with the course team on Tuesday afternoon, online." → time found, link created, invitations sent — one step. *(Day planning: A6 · links/online: E7)*

**27 · Common calendar**
A shared month view of every meeting and event. Open to everyone — anyone can see it and edit it, including adding/removing people. Whenever something changes, everyone affected is told what changed and who changed it.
✦ "Arun moved Thursday's review to 3pm and added Meena. You were already free." *(Detail: appendix E)*

**28 · Meeting decisions carried through**
Takes the notes, identifies what was decided, assigns actions to named people, follows up until done.
✦ "You agreed to review the AI Basics module by Friday — is that done?"

**29 · Events**
Runs an event from proposal to conclusion — tasks, budget, suppliers, speakers, registrations, materials, closing report.
✦ "The event is in nine days. Three tasks are overdue and registrations are behind where they were last time."

**30 · Rooms and utilities used**
A record of which rooms were used and how long equipment ran each day, captured by a short question rather than a register.
✦ "Hall 1 — air conditioning on, 9am to 6pm, Tuesday." Recorded in seconds, lookable-over for any period.

**31 · Equipment register**
A record of equipment, who holds it, condition, servicing history. Faults reportable on the spot, including by voice.
✦ "The projector in Hall 2 has been reported faulty three times this month."

**32 · Document storage**
Documents filed against the record they belong to (course, employee, event) with version history and access by role. **It knows which documents are required, not only which have been supplied.**
✦ "The insurance certificate expires in thirty days."

**33 · Announcements and policies**
Sends notices/policies to the organization and records who has confirmed reading them.
✦ "Six of twenty-two people have not acknowledged the new policy. Send a reminder?"

---

## 6. THE APPENDICES — the rules behind the features

> "Most features are fully described by a line and an example. Five have rules that do
> not fit there, and those rules decide whether the feature is useful or resented."
> These are the make-or-break details. **Nothing here is optional.**

### Appendix A — Daily commitments (feature 14)

**A1 · The morning conversation.** The first time the app is opened each day, the brief arrives as a **conversation**, not a list of cards. The assistant works through items one at a time, waiting for an answer before moving on; the day is planned in the same conversation.
- ★ **Every question carries tappable replies inside the conversation.** The whole brief can be cleared without typing a single word. (Typing/speaking remain available for anything the buttons don't cover.)
- When the brief is finished it asks "what are you doing today?" — you choose from what came out of it or add something else.
- **For each item you give a time estimate. This is required, not optional.** If you skip it: "I need a time for each one — otherwise I cannot tell later whether it ran over or whether something else took the time." Nothing is committed until every item has one.
- The conversation ends and the day appears on the dashboard.
- ★ **This happens once a day.** Reopening in the afternoon goes straight to the dashboard — the brief does not return.
- *Why conversation-first + buttons:* chat-first must never mean typing-first. Nobody types eight answers on a phone every morning; they'd stop within a week.

**A1b · The dashboard afterwards.** Shows the day as current work status — committed work interleaved with existing meetings, in time order (the real day, not an empty one, see A6). Checkbox on each item, ticked as you finish. **Items can be dragged into any order, at any time** — the morning plan is a starting point, not a contract. The assistant stays available from the dashboard.

**A1c · Where the assistant speaks during the day.** One assistant, one voice, two places:
- **In the chat** — anything with substance (morning brief, planning, explaining a miss, anything you want to discuss).
- **A small prompt on the dashboard** — single things answerable in one tap, shown where you're working. Every prompt carries an **"explain in chat"** option that opens the conversation with that item loaded.
- ★ **The chat never opens by itself while you are working.** You tapping into it is fine; it appearing over what you're doing is not — that's the behaviour people switch off.

**A2 · Telling the two kinds of miss apart.** When a committed item isn't finished in its time, the app looks at the committed window and asks itself one question: *did something else take that time?* It checks meetings, room bookings, other commitments in the window and how much they consumed.

| | INTERRUPTED | RAN OVER |
|---|---|---|
| What happened | Something else took the time | The work simply took longer |
| Does it know why? | Yes — it scheduled the meeting | No |
| Question asked | None | One, short |
| Streak | Unaffected | Breaks |
| Dashboard shows | "carried over — meeting" | "ran over" |

- ★ **The rule that matters most: only ask when the app genuinely does not know.** If it asks "why didn't you finish?" about an hour consumed by a meeting it booked itself, people stop trusting it — the fastest way to make the system feel like a supervisor.

**A3 · When you were interrupted.** No question asked. Remaining time carried to your next available slot, or you reschedule. Streak unaffected — you didn't fail, you were interrupted. Dashboard records "carried over" with the cause, not as failure.

**A4 · When it simply ran over.** Two separate moments that must not be confused — the app speaks when time runs out AND again when work is finished, saying completely different things:

| | THE MOMENT IT RUNS OVER | WHEN FINISHED / END OF DAY |
|---|---|---|
| What it says | An **offer** — about what to do next | A **question** — about what happened |
| Why then | You're still working. Useful now | You've finished. Costs nothing to answer |
| Interrupts? | Yes — briefly, because it helps | No — it waits for you |

- *The moment it runs over (an offer):* ✦ "Module 4 is running over. Your 12:00 session will not fit. [ Move it ] [ Drop the Friday prep ] [ Leave it ]". About what to do **next**, never what went **wrong**. Appears **only if the overrun actually affects the rest of the day** — if nothing later is at risk, it says nothing and lets you carry on. Whatever you choose, the day rearranges itself.
- ★ *Key distinction:* Asking "why didn't you finish?" while someone is still working = supervisor feel. Saying "this is overrunning and your afternoon won't fit" at the same moment = genuinely helpful. Same timing, opposite effect. **Interrupt to help, never to interrogate.**
- *When finished / end of day (the question):* ✦ "The module took four hours against the two you planned. What happened?" One short question, only one. Asked when you tick the item complete late, or end of day if still unfinished — **never while mid-task.** Answerable in one tap from the dashboard, or in chat. **Counts against the two-questions-per-person-per-day limit.** If ignored, lapses quietly — no reminder, no second ask; recorded as unexplained.

**A5 · What it does with your answer.** Sorted into a reason — underestimated, blocked by someone else, the work grew, something else — and **used to improve future estimates rather than to judge you.** ✦ "You said two hours and it took four. That is usual for review work — shall I plan for four next time?" A miss becomes better planning, not a black mark. That is the entire purpose of asking.

**A6 · Meetings.** Handled two ways, decided by one thing only: *was the meeting already booked when the day was planned?*

| | WHAT HAPPENS |
|---|---|
| **Already booked when you plan** | Built into the plan from the start. You commit work around it, never as if the day were empty. |
| **Booked during the day** | Simply accepted. Appears in your day, displaced work marked interrupted, nothing negotiated. |

- *Planning around existing meetings:* meetings and committed work in one sequence in time order (not two lists). The app shows what's left: meeting time, committed work time, time still free. If they don't fit it says so before you commit: ✦ "You have 1½ hours of meetings and have committed 6 hours of work. That is more than the day holds."
- *Meetings arriving later:* goes in, no warning to organiser, no alternative time offered, no one asked to move. Displaced work rescheduled automatically and marked interrupted. You're not asked why that work didn't finish; streak unaffected. You're just told: ✦ "Arun booked a review 11–12. Module 4 moves to tomorrow. [ OK ]"
- *Why it's this simple:* a plan can only clash once it exists, and plans are made each morning. A meeting for next week can't conflict with a day nobody has planned yet — so the only real case is a meeting booked today for today, not worth negotiating. Accept it, show it, don't blame anyone.

**A7 · Streak.** A day counts **clean** when every committed item finished within its time. Interrupted misses don't break it; ran-over misses do. A day with no commitments neither builds nor breaks it. **Personal only** — not visible to the team, not compared between people, not shown to a manager.
- ★ *Watch for this:* streaks tempt people to protect them by **padding estimates** (saying four hours for a two-hour job). The signal to watch is the gap between what someone estimates and what the app has learned they actually need. If those drift apart over time, the streak is distorting the data.

**A8 · Who sees what.**

| | THE PERSON | THEIR MANAGER |
|---|---|---|
| What was committed | Yes | Yes |
| Whether it was done | Yes | Yes |
| Time estimates | Yes | Yes |
| Streak | Yes | **No** |
| Reason given for a miss | Yes | Open — see below |

- *Still to decide:* whether a manager sees the reason someone gives for a miss. **Recommendation: they do not** — the reason stays between the person and the app. People answer honestly when nobody is reading over their shoulder, and honest answers are the only thing that makes the A5 estimate-learning work at all.

**A9 · Edge cases.**

| Situation | What happens |
|---|---|
| Planning abandoned halfway | Nothing committed — an item without a time never becomes part of the day. Next open **resumes** where it stopped ("you were choosing what to do today — shall we finish?") rather than restarting the brief. If never finished, the day is simply unplanned: not chased, no streak effect. |
| Never started at all | Treated as ran over, unless something else took the window → then interrupted. |
| Half done | Progress recorded, remainder carried forward. Only the shortfall counts against the day. |
| Item added mid-day | Allowed. Needs a time estimate like anything else. |
| Item dropped mid-day | Allowed. Asked once why; does not break the streak. |
| Work spanning several days | Commit a slice per day, not the whole thing. Estimating a five-day job in one line is where this feature would otherwise fall apart. |
| A day with no commitments | Fine. Not chased, no streak effect either way. |
| The question is ignored | Lapses quietly. Recorded as unexplained, never asked again. |
| Someone is on leave | No commitments expected, nothing asked, streak **paused** rather than broken. |

### Appendix B — Earning the right to act alone (feature 09)

- Every new automatic action begins **supervised** — it prepares the work and asks a person, every time.
- **After ten approvals in which nothing was changed, it offers to graduate.**
- Editing the draft **resets the count.** Approval only counts when the person accepted it as written.
- Graduation is **offered, never assumed.** A person has to agree.
- **One tap returns it to supervised**, at any time, by anyone permitted.
- **Three categories never graduate**, regardless of record: anything involving **money**, anything affecting a **person's employment**, and anything that **leaves the organization**.
- An automatic action runs under the authority of whoever set it up, **capped at what that person could do by hand.** If their role changes or they leave, it **suspends automatically** — no rule outlives its owner.

### Appendix C — Roles and permissions (feature 04)

Three levels, **applied together** (a role alone is not enough — it can't express "this person sees their own team, not everyone").

| Level | Question it answers | Example |
|---|---|---|
| **Role** | What kind of user is this? | Course writer, HR, finance, manager |
| **Record** | Which records concern them? | Their own team, their own courses |
| **Field** | Which parts of a record? | Can open the employee record, cannot see the pay |

- *Worked example:* a course writer opens a colleague's employee record. Role permits opening employee records at all. Record level limits them to their own team. Field level hides pay and performance notes. They see a name, a role and a contact number — and the assistant, asked the same question, returns exactly the same and no more.
- **Actions are controlled separately:** viewing, creating, editing, approving, exporting, deleting.
- ★ **Exporting is not the same as viewing.** Being able to see a list on screen and download it are different rights — conflating them is the most common mistake in systems like this.
- **The common calendar is exempt** — no role restriction applies to it (section E).
- The same rules apply identically whether someone uses screens, types to the assistant, or speaks — so **the assistant can never become a way around them.**

### Appendix D — What the assistant will and will not comment on (feature 07)

The personal assistant does three things; the third needs a boundary.

| Level | What it means | Example |
|---|---|---|
| **Answers** | You ask, it tells you | "Who is waiting on me?" |
| **Suggests** | Offers something you didn't ask for; you decide | "Want me to send that list every Monday?" |
| **Points things out** | Warns you about your own work before it bites | "You've committed 8 hours to a day with 3 hours of meetings." |

**It comments on the work** (all facts the app can already see — commitments, calendar, deadlines, dependencies; pointing out what is already true, not forming an opinion):
- "You have committed eight hours of work to a day that already has three hours of meetings."
- "This has been on your list four days running."
- "The course is due Friday and two of its modules have not been started."
- "Arun is waiting on your review before he can continue."

**It does NOT comment on the person:**
- ~~"You work more slowly in the afternoons"~~
- ~~"You should take a break"~~
- ~~"You are behind compared to Priya"~~

★ *The line:* the moment the assistant comments on **you** rather than your **work**, it stops being a colleague and becomes something people switch off. **Comparing people is never done, in any feature, anywhere.** Workload, deadlines and dependencies are fair game because they are observable facts about the work. Habits, pace and character are not.

### Appendix E — Common calendar (feature 27)

**E1 · What is on it — and what deliberately is not.**

| ON the calendar | NOT on the calendar |
|---|---|
| Meetings — internal and external, with attendees | Halls/rooms (booked/viewed in feature 25) |
| Events — the ones the organization runs | Leave |
| | Individual daily work (that's the dashboard) |
| | Deadlines, expiries, holidays (the assistant raises these directly) |

Two things only — resist adding layers until every cell is full and nobody can see anything.

**E2 · A month view, and only a month view.** Monthly is the only view (the dashboard covers today hour-by-hour; a day/week view would duplicate it). A cell shows **density, not detail** — a dot per meeting, events named because there are few. Tap a day for the full list; tapping today opens the dashboard. Answers questions only a month view can: "can we run an event on the 18th?", "how many meetings that week?", "what's already booked in September?"

**E3 · Open to everyone — no permission restriction.** The one deliberate exception to the permission model (section C). Everyone can see everything and change everything: anyone can create, edit (time/date/title/detail), add or remove people (including from meetings they didn't create), or cancel. **No owner privilege, no organiser lock, no role that can do more than another.**
- ★ *What replaces permission as the safeguard* — open editing is only safe if nothing can happen quietly. **All three are required**; dropping any one makes the open calendar unsafe:
  1. **Everyone affected is told** — what changed, and who changed it.
  2. **Every change is recorded** (feature 05 in full: who, when, what it was before).
  3. **Every change can be undone** — one action restores what was there, everyone told again.

**E4 · Including and excluding people.** People can be added/removed at any time, by anyone, before or after arrangement. Chosen by name or by description ("the course team", "everyone working on the AI Tools course") — the assistant resolves the description to actual people and **shows who it picked before anything is sent.** While choosing, it shows what each person already has at that time (clash visible before the invitation goes out). **Removing someone tells them, and says who removed them** — being dropped silently is the single worst thing an open calendar can do.
✦ "Adding the course team — that is Priya, Arun and Karthik. Karthik already has something at 11."

**E5 · When something changes.** Calendar updates immediately for everyone. Everyone in the meeting/event is told in the form they normally receive things (a line in the brief, or a notification if imminent). The message **always names what changed and who changed it**, never just "this meeting was updated." **Undo is offered to anyone affected, not only whoever made the change.** If the change lands on committed work, A6 applies (work reschedules itself, marked interrupted).
✦ "Arun moved Thursday's review from 11:00 to 15:00 and added Meena. [ OK ] [ Undo ]"

**E6 · By conversation as well.** Everything above works through the assistant, not only on screen: "Move tomorrow's review to 3 and add Meena" · "Who is coming to Thursday's event?" · "Cancel Friday's catch-up and tell everyone" · "What is already booked the week of the 15th?"

**E7 · In person, online, or both.** Every meeting is one of three kinds, chosen at creation:

| Kind | What the app does |
|---|---|
| **In person** | A room is booked through feature 25, checked for capacity and equipment. |
| **Online** | A meeting link is created automatically and sent to everyone invited. |
| **Both** | A room and a link — anyone who can't come in can still join. **Should be the easy default, not an afterthought.** |

- *The link:* created the moment the meeting is created — nobody generates, copies, or pastes a link. Sent to everyone invited with the invitation, in one action. **Does not change** when the meeting is moved/renamed/edited (a link that changes every time is worse than none). Visible in three places: calendar entry, invitation, each person's day. ★ Anyone added later is sent the link **automatically** (adding a person to an online meeting without the link is the most common way this goes wrong). Cancelling the meeting ends the link.
- *People outside the organization:* external attendees invited by email, receive link + details the same way, need no account, see nothing else. Appear on the meeting as **external** so it's always clear who isn't staff.
- *Provider not yet chosen:* the behaviour is specified regardless of provider. **Google Meet is the likely candidate and the user's stated expectation**, but it sits with the wider provider decision (still open). Nothing in E7 depends on which is chosen.

---

## 7. THE SCREENS (from the mock UIs)

All screens are **staff side only**. No bottom tab or screen exists for anything outside the
plan. Every screen traces to the PDF; streaks never appear on the team screen; permission is
field-level (pay shows as 🔒 Restricted, never silently missing). The ✦ diamond on every
screen is the assistant — click/hold it and speak; spoken instructions are read back before
anything is saved.

### 7.1 Web — four desktop screens (`Mock-UI-Web.html`)

Shared chrome: browser frame, left **sidebar** with user card + nav (Today, Calendar, Courses, Team, Rooms & events, Documents) and a pinned Assistant panel. The sidebar maps to the plan's six service areas.

**01 · Home dashboard** (`/today`)
- Morning brief pops up as a **conversation modal** on first open of the day (A1) — one item at a time, tappable replies, gone until tomorrow. Header reads "Your morning brief · 2 of 4 left".
- **Your day** card (drag-to-reorder plan) with meetings + work interleaved in time order, plus a tally: "Meetings 1h 30m · Work 4h · Free 1h 30m".
- **Course progress figure** (60% done) that opens into its parts (3 of 5 modules finished, 1 in review, 1 not started) — feature 06.
- **Streak card** — dark, personal ("only you see this"), 3 concentric rings: clean days (mint), finished-within-time (amber), day-planned (coral). "12 clean days".
- **Technology & AI news** panel — same for everyone; items flagged "Affects your course".
- FAB ✦ assistant + "Listening — just say it" indicator.

**02 · Course pipeline** (`/courses`)
- 4-column kanban: **Outline → Draft → Review → Published**, each with stage counts.
- Cards show title, owner avatar, module progress, version (v1…v12 · history).
- Review column shows a **dark "waiting 8 days"** overdue card (feature 23).
- Assistant prompt: "AI for Presentations has been waiting for review for eight days."

**03 · Team** (`/team`)
- **Directory** (feature 16): Name · Role · Contact · **Pay (🔒 Restricted)** — restricted is shown explicitly, not hidden.
- **Building now** (feature 19): live course-team progress bars (60% / 85% / 35%).
- **Capability gaps** (feature 21): tagged 1-person / Ageing / Covered.
- Assistant prompt: "Only one person can build courses on data analysis. If they leave, that subject stops."
- ★ **No streaks appear here, ever.**

**04 · Common calendar** (`/calendar`, August 2026)
- Month view only (E2); cells show density dots + named events (SHOWCASE on 18th, TOWN HALL on 28th).
- Toast: "Arun moved Thursday's review from 11:00 to 15:00 and added Meena. You were already free." with **[ OK ] [ Undo ]** (E5).
- Works by conversation too: "Move tomorrow's review to 3 and add Meena".

### 7.2 Mobile — four phone screens (`Mock-UI-Mobile.html`)

Bottom nav: Today · Calendar · ✦ (Hold to speak) · Team · More.

**01 · Morning brief** — chat bubbles (AI serif-italic gold; user dark), tappable chip replies, time chips (1h/2h/3h), input bar with mic. "A time for each item is required, not optional."

**02 · Today** — dark hero "Committed today · 4h work · 1h 30m meetings · 1h 30m free · 2 of 4 done"; time-ordered rows (done/meeting/normal); carried-over tag (grey, meeting) vs ran-over tag (coral); a one-tap "Asking" prompt when something ran over.

**03 · Streak** (personal, "Only you can see this") — three rings (clean days / finished within time / day planned); week strip with states **full / kept / miss / pause / todo** and the rule: "Wednesday interrupted by a meeting — streak kept. Thursday ran over — broke. Friday leave — paused, not broken." ★ "Never shown to a manager, never compared with anyone."

**04 · Calendar** — month grid (density dots, named events); bottom sheet for a day's meetings; undo toast.

### 7.3 Interactive demo (`Demo-Today-Screen.html`)

A working walkthrough of the **chat-first → dashboard** flow for **James D.**, Monday 5 August.
Sample brief items (with the exact tap-replies and AI responses): Ravi's missed checkout → "Set 4:00 pm / Open visit"; Priya's Friday leave → "Approve / Decline"; three unsigned contracts (Karthik, Divya, Naveen) → "Chase them / Later"; tool-update vs. 8-month-old course → "Open the course / Dismiss".
Then planning: pick work items (Module 4, Review Arun's draft, Prepare Friday session, Chase contracts), **mandatory** time per item, day built around the 11–12 Arun review. Demo buttons: **Start again / Jump to 6:00 pm (ran-over question) / Reopen at 2pm (brief does not return)**. The ran-over question then offers to re-estimate next time (A5).

### 7.4 Demo people (recurring names across artefacts)

| Person | Role | Notes |
|---|---|---|
| James D. | Course lead | The user/POV in demos |
| Priya R. | Course writer | Builds AI for Data Analysis; asks Friday leave |
| Arun S. | Course writer | Lightest load; "best for the work"; moves meetings |
| Meena K. | Reviewer | Leaves with laptops + a course still in her name |
| Karthik V. | Course writer | Spreadsheet Automation refresh |
| Divya M. | Course writer | AI Basics 2nd ed.; missing contract |
| Ravi | — | Missed checkout (checked in 10:05, no checkout) |
| Naveen | — | Missing signed contract |

---

## 8. THE FLOW DIAGRAM (`System-Flow-Branching.html`)

The "whole application, one chart." Across = different kinds of thing; down = order they happen; diamond = a question with two answers. The four lanes use the build scope's own section headings (the four families), with detail one click away.

**Top band — the seven starts**, split: left "A PERSON ASKS" (form / type / say) and right "THE APPLICATION ACTS BY ITSELF" (schedule fires / record changed / standing rule / noticed routine).

**Pre-gate branching (the journeys differ here):**
- *Spoken?* → "Turn it into words" → **"Read it back — is that what you meant?"** (no → "Nothing is saved").
- *Application acting alone:* → **"Does the rule author's authority still cover it?"** (no → "Suspended. The author is told") → "It runs under that person's authority, capped at their permissions right now".
- Both converge on: **"One named operation, its arguments, and whose authority it runs under."**

**THE GATE (dashed teal box)** — six checks in order:
1. Arguments complete and valid? *(no → "Say exactly what is missing")*
2. Role, records and fields allow it? *(no → "Refuse — without revealing that the record exists")*
3. Did a person ask for this just now? *(yes → "It runs under their own hand")*
4. Does it involve money or people? *(yes → "It always asks. Never automatic")*
5. Has this rule earned the right? *(no → "Prepare it, then ask")*
6. → **It runs.**

**Four lanes of work** (clickable capabilities, each opening its own decisions — examples captured in §5):
- **PEOPLE** (teal #14615A) — employee records, leave & attendance, joining/leaving, course team progress, who-is-best, capability gaps, organizational memory.
- **COURSE** (purple #574689) — course building pipeline, presentations & documents.
- **WORKPLACE** (blue #29527E) — room/hall booking, meetings & video calls, meeting decisions carried through, events, rooms & utilities used, equipment register, document storage, announcements & policies.
- **EVERYDAY** (amber #8C5A16) — one connected record, personal assistant, suggestions from watching, daily briefing, tech & AI news.

**After the work — the second narrow:**
- **Record it:** who did it, under whose authority, what changed, how to undo it.
- **Publish the change.**

**What the change sets off (amber):** a standing rule matches it → re-enters at the top; an agreed action completes → stop chasing; an answer now exists → ask one short question; something watched changed → add it to their briefing. *(An amber "back to the seven starts, as a new operation" loop runs up the left side.)*

**How it comes back (blue):** Is it being spoken back? (no → "Shown where it was asked") → Is the room shared and are there restricted fields in it? (yes → "On screen only. Not read aloud") → Speak it → **Any figure comes with the parts it was computed from** → **Delivered.**

The three notes at the bottom of the chart: *why it narrows twice* (the two waists are the whole argument); *why four lanes not twenty-three* (readability — whole map visible at once); *where the branches actually matter* (a form skips speech/read-back; an unattended rule skips them but answers every gate question; only a spoken request ever reaches "is the room shared?").

---

## 9. OPEN DECISIONS — and which are now resolved

The spec deliberately left implementation choices open (none changes the shape). Most have
now been **resolved** in `BUILD-PLAN.md`; a few remain open.

### ✅ RESOLVED (build decisions — see `BUILD-PLAN.md` for detail)
- **Programming language & framework** → **Next.js (TypeScript)** for the spine + web app.
- **Hosting** → **Google Cloud Platform**, fully serverless in **asia-south1 (Mumbai)**:
  **Cloud Run** (scale-to-zero) for compute, **Supabase** Postgres (+ Auth / Storage / Realtime)
  for data, **Upstash** Redis, **Cloud Storage** for files. **No VM.**
- **Whether an off-the-shelf system supplies staff records underneath** → **Yes: Frappe HR,
  forked (our source)**, run headless on Cloud Run with its always-on scheduler/workers
  externalized to **Cloud Scheduler + Cloud Run Jobs**. Sits below the record layer; nothing
  above it changes. **Not Frappe Cloud.**
- **Payroll / statutory compliance** → **in scope** (justifies Frappe's maintained compliance).
- **Desktop delivery** → browser web app (Win/Linux/Mac, zero install). **Mobile** → deferred;
  spine stays API-first so any native tech works later.

### ⬜ STILL OPEN (abstracted behind adapters — do not block the build)
- **Video provider** — Google Meet is the likely candidate and the user's stated expectation,
  behind a provider-agnostic adapter (appendix E7).
- **LLM / reasoning provider** for the assistant, document generation, and standing-rule
  interpretation — provider-agnostic client.
- **Exact headcount** — affects only Cloud Run sizing/concurrency, not the architecture.
- **Whether a manager sees the reason given for a miss** (appendix A8) — recommendation: they do not.

### From the build-vs-buy research (§11) — resolved
- [x] Production deployment vs portfolio/learning project → **production**.
- [x] Use as-is, fork-and-extend, or just study the architecture → **fork-and-extend (Frappe HR)**.
- [x] Country / payroll compliance requirements → **Indian statutory in scope** (Frappe first-class).
- [ ] Headcount (10 vs 500) — sizes infra only.
- [ ] Will it ever be offered as a hosted service? (decides the GPL-3.0 question.)
- [ ] Verify Frappe's Indian statutory compliance against the org's actual requirements.

---

## 10. WHAT IS PARKED / OUT OF SCOPE

- **"Course quality check"** — referenced in the branching flow footer as a parked (not dropped) capability. In the current PDF it is absent: course work now runs from the pipeline straight to publication. It can be put back without changing anything else on the chart. (See §12 numbering note.)
- The **common calendar** deliberately excludes rooms (feature 25), leave, individual daily work (the dashboard), and deadlines/expiries/holidays (the assistant raises these directly) — appendix E1.
- The assistant **never** comments on the person (habits/pace/character) and **never** compares people — appendix D.

---

## 11. BUILD-VS-BUY RESEARCH (`open-source-ems-erp-options.md`)

Research date 2026-08-04. Scope: EMS/HRMS and full ERP, open source only. GitHub numbers
verified via the GitHub API. This was the shortlist considered for sitting beneath the
record layer — **a decision has since been made: Frappe HR, forked and run headless**
(see §9 and `BUILD-PLAN.md`). The rest is retained as background.

### Quick answer
| Goal | Pick | Reason |
|---|---|---|
| HR only | **Frappe HR** | Complete & free, nothing paywalled, Indian payroll built in |
| HR + accounting/inventory | **ERPNext** | Same platform as Frappe HR, no Enterprise edition exists |
| Fork / learn / build on top | **Horilla** | Plain Django + LGPL-2.1, easiest code to read/modify |
| May sell as closed product | **Apache OFBiz** | Only Apache-2.0 (permissive) option |
| Best UI / demo appeal | **Odoo Community** | Best looking, but payroll + full accounting are paid |

### The 4 that survived
- **Frappe HR** — github.com/frappe/hrms · 8,321★ · GPL-3.0 · Python (Frappe Framework) · commits daily · **no paid edition (100% of the product)** · ~13 modules · India statutory compliance (PF/ESI/TDS/gratuity/professional tax) first-class (vendor is India-based) · runs standalone · weakness: no low-code builder, changes need Python. (Naming: "Frappe" = framework; "Frappe HR" = the EMS, formerly "ERPNext HR".)
- **ERPNext** — github.com/frappe/erpnext · 37,543★ · GPL-3.0 · **largest genuinely-open ERP, no Enterprise edition** · accounting/inventory/manufacturing/sales/purchase/CRM/projects/HR · upgrades painless (customizations stored as metadata DocTypes, not forked code) · growing from Frappe HR into ERPNext is an install, not a migration · weakness: rougher UI than Odoo, no drag-and-drop studio.
- **Horilla** — github.com/horilla/horilla-hr · 1,309★ · **LGPL-2.1 (loosest copyleft here)** · plain Django (no custom framework to learn) · recruitment/onboarding/attendance/leave/payroll/assets/helpdesk/offboarding · vendor claims PF/ESI/TDS/professional tax (**VERIFY**) · smallest team, thinnest docs · managed cloud ~$7/user/month.
- **Odoo Community** — github.com/odoo/odoo · 53,445★ · LGPL-3.0 · best UI/docs, ~30k community addons · **but open-core** (see below).

### Ruled out
OrangeHRM (open core), IceHrm (open core), Sentrifugo (**dead — last commit 2021**), Ever Gauzy (AGPL, time-tracking niche), MintHCM (AGPL, tiny), OpenHRMS (not standalone — Odoo addon bundle), Axelor (Java/AGPL, heavyweight), metasfresh (Java/GPL-2.0, wholesale niche), iDempiere (Java/OSGi, small), Apache OFBiz (Apache-2.0 good, but a framework not a product), Tryton (clean, near-zero community), Bigcapital (accounting only).

### Odoo Community — free vs paid (critical)
**Free (LGPL-3):** CRM, Sales, **Invoicing only**, PoS, Contacts, Calendar, Discuss, Inventory, Purchase, MRP, Maintenance, Repairs, Fleet, Projects, Timesheets, HR (Employees/Recruitment/Time Off/Attendances/Expenses), Website/eCommerce/Blog/Forum/Live Chat, Email Marketing, Events, Surveys. Full source, unlimited users/customization.
**Enterprise-only (paid, closed):** **Odoo Studio** (no-code tool), **Full Accounting** (bank sync/recon/assets/budgets/consolidation), **Payroll** ← matters most for an EMS, **Appraisals**, native mobile apps, version-upgrade tooling, Helpdesk, Field Service, Planning, Quality, Sign, Documents, Marketing Automation, Appointments, IoT, **all Odoo 19 AI features**.
→ *Planning implication:* Odoo Community gives employee records/recruitment/leave/attendance free, but **payroll and appraisals are behind the paywall** — usually the two main reasons to want an HRMS. Frappe HR includes payroll + appraisals + Indian compliance for free.

### License cheat sheet (confirmed from LICENSE files, not GitHub labels)
- **Apache-2.0** (OFBiz) — permissive; only safe choice to ship closed-source/sell a derivative.
- **LGPL-2.1** (Horilla) — loosest copyleft; friendliest to build on.
- **LGPL-3.0** (Odoo Community) — run/host freely; lenient linking.
- **GPL-3.0** (Frappe HR, ERPNext, Dolibarr) — free to run/host; copyleft triggers on **distribution**.
- **GPL-2.0** (metasfresh, iDempiere) — older version.
- **AGPL-3.0** (Axelor, Ever Gauzy, MintHCM, Bigcapital) — strictest; **hosting as a service obligates publishing modifications**.
- *Rule of thumb:* internal use → any; public SaaS → avoid AGPL unless you'll publish changes or buy a commercial license; closed/proprietary product → Apache OFBiz only.

### Infrastructure requirements
| System | Minimum | Production |
|---|---|---|
| ERPNext / Frappe HR | 4 GB RAM, 2 cores, 40 GB, 2 GB swap | 8 GB RAM, 4 cores, 100 GB SSD |
| Odoo Community | 2 GB RAM, 2 vCPU, 20 GB (dev only) | 4–8 GB RAM, 4 cores (~25 users); 16 GB for ~50 users |
| Horilla (Django) | Lightest of the three | Scales with normal Django practice |

All three run via Docker. Use Linux for production (Windows/WSL2 dev only). Odoo workers ~150–300 MB each; budget 6–8 workers per 50 users.

### Terminology
- **EMS/HRMS** = people layer only (employee records, attendance, leave, payroll, appraisals). **ERP** = whole business on one shared DB (accounting, inventory, sales, purchasing, manufacturing, projects — **and HR as one module**). So an EMS ≈ one module's worth of an ERP.
- Frappe: **Frappe Framework** = web framework (not an EMS); **Frappe HR** = the EMS product (install this); **ERPNext** = the full ERP on the same framework.

### Architecture references (if studying rather than deploying)
- **Frappe DocType** — schema, permissions, forms and REST API all generated from one JSON. Most interesting idea in this space.
- **Odoo ORM + `_inherit`** — addons patch core models without forking. Excellent extensibility.
- **Apache OFBiz entity/service engine** — XML-declared data model and service contracts; most explicit SoC.
- **Tryton** — smallest codebase to read end-to-end to understand modular ERP.

---

## 12. DISCREPANCIES, NUMBERING & GOTCHAS (read this before quoting numbers)

- **"32 capabilities" vs the PDF's 33 features.** The architecture materials (`System-Architecture.md`, the flow footer) describe a **32-capability** version and park **"#23 — course quality check"** (course work running pipeline→publication without it). The current **PDF lists 33 items, 01–33, with no "course quality check"** — it appears to have been removed and course work now goes straight from pipeline to publication, exactly as the parked note predicted. **Treat the PDF as canonical for numbering (33 features).**
- **Numbering differs between the PDF and the flow diagram lanes.** The branching HTML uses an **older numbering** (e.g. it labels "Technology and AI news" as **14** and "Employee records" as **15**, whereas the PDF labels them **15** and **16**). When citing a feature number, **use the PDF's numbering** and refer to the *lane* by name for the flow diagram.
- **The flow footer's own count:** "31 of the build scope's 32 capabilities are on this page — 9 on the spine, 22 in the four lanes. Nothing names a language, a framework or a provider."
- **Two earlier-vs-later artefact pairs:** `System-Architecture.md` mentions a `System-Flow.html` (earlier, straight-down version) in its diagram table — that file is **not present** in this folder; only the branching version is.
- **PDF generation:** the PDF was produced by headless Chrome (Edge 151 / Skia/PDF m151) on Windows, A4, 15 pages, created 2026-08-05. So it is a print-to-PDF of a web-rendered spec, not a hand-authored doc.
- **Demo dates:** mock UIs use **Wed 5 August**; the interactive demo and PDF appendix text use **Monday 5 August**. August 5, 2026 is in fact a Wednesday — treat dates as illustrative, not authoritative.
- **Currency of research:** the build-vs-buy research is dated **2026-08-04** (star counts etc. are point-in-time).

---

## 13. QUICK-REFERENCE — the non-negotiables

If you forget everything else, these are the rules the design refuses to bend:

1. **One gate.** All seven starts funnel through it; permission and the activity log live only there.
2. **Refusal never discloses** that a record exists.
3. **Money + people + leaving-the-org actions never go automatic** (appendix B).
4. **Autonomy is earned (10 clean approvals) and revocable in one tap**; a rule never outlives its owner.
5. **Voice always confirms before saving**; restricted info is never read aloud in a shared room.
6. **Daily commitments: conversation-first, tappable replies, mandatory time-per-item, once-a-day** (appendix A1).
7. **Two kinds of miss** — interrupted (no question, streak kept) vs ran over (one short question later, streak breaks). **Never ask "why didn't you finish?" while someone is still working** (A2/A4).
8. **Streaks are personal only** — never shown to a manager, never compared (A7/A8, appendix D).
9. **The assistant comments on work, never on the person; never compares people** (appendix D).
10. **Exporting ≠ viewing** (appendix C).
11. **The common calendar is open to everyone** — safeguarded by *notify + record + undo*, all three required (appendix E3).
12. **At most two questions per person per day**, everywhere (feature 11).
13. **Any figure can be opened into the parts it was computed from** (feature 06).

---

*End of consolidated context. Everything in this folder is reflected above; the PDF
`Application-Build-Scope.pdf` remains the single upstream authority for feature text and
appendix rules.*
