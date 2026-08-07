# System Architecture — Organization A

A plain description of how the application is put together.
Based on **Application-Build-Scope.pdf** (32 capabilities).

---

## The main idea

All 32 capabilities are the same kind of thing: **an operation**.

Booking a room is an operation. Approving leave is an operation. Sending a reminder
is an operation. What differs is only *who starts it*:

**A person can start one in three ways**
- filling in a form
- typing it
- saying it out loud

**The application can start one in four ways**
- a schedule fires
- a record changed
- a standing rule matches
- it noticed a routine someone repeats by hand

That is seven different starting points — and **all seven go through the same gate**.
This one decision shapes everything else.

---

## The shape

```
   seven ways it can start          ← wide
            ↓
        THE GATE                    ← narrow
            ↓
  people · course · workplace       ← wide (the actual work)
            ↓
   record it and publish it         ← narrow
            ↓
   what it sets off  ·  how it reaches you
```

It narrows twice. Those two narrow points are the important part:

- **Nothing touches a record without passing the gate.**
- **Nothing changes without being recorded and published.**

Because everything funnels through those two points, permission checking and the
activity log only have to be built **once** — not separately for forms, for voice,
for the assistant, and for scheduled jobs.

---

## The parts

**The surfaces**
Web and mobile. Forms, typing and voice all produce the same result — because they
all end up calling the same operation.

**The assistant**
Not one assistant that does everything. A coordinator splits a request across
specialists (people, courses, rooms, documents, and so on) and returns one answer.
Each person's assistant knows only that person's work.

**The gate**
Every operation passes six checks:

1. Are the arguments valid?
2. Does this person's role, record access and field access allow it?
3. Did a person ask for this just now?
4. Does it involve money or people?
5. Has this rule earned the right to act alone?
6. Then it runs.

**The services**
Six areas that own the actual records: people and employment, skills and capacity,
course work, workplace, meetings and events, documents and notices.

**The record**
One connected store — people, courses, rooms, equipment, documents and decisions all
linked to each other, so one question can cross all of them. It keeps history over
time, and every figure keeps the parts it was calculated from.

**The background side**
Standing rules, the scheduler, the daily briefing, the routine watcher, and the
question scheduler that asks at most two short questions per person per day.

---

## Rules that always hold

| Rule | What it means |
|---|---|
| Permission is checked at the gate | Not in the screen, and not by the assistant. So the assistant cannot reveal what its user could not already open. |
| Refusal does not disclose | If someone may not see a record, the reply does not hint that it exists. |
| Money and people always ask | These never become automatic, however many times they are approved. |
| Autonomy is earned, and revocable | A rule acts alone only after repeatedly getting it right. It runs under its author's authority, capped at that person's permissions right now. |
| Everything is recorded | Who did it, under whose authority, what changed, and how to undo it — including anything the application did by itself. |
| Voice confirms before saving | Spoken instructions are read back first. Restricted information is never read aloud in a shared room. |

---

## Not decided yet

These are deliberately left open. None of them changes the shape above.

- Programming language, framework and hosting
- Which external services are used for sign-on, calendar, video, file storage,
  speech, notifications and the reasoning model
- Whether an existing off-the-shelf system supplies staff records, leave and
  attendance underneath. If one does, it sits below the record layer and nothing
  above it changes.

---

## The diagrams

| File | What it shows |
|---|---|
| `System-Flow-Branching.html` | The full chart. Branches out, narrows at the gate, opens into four lanes of work, narrows again, then fans out to delivery. Click any capability to see its own decisions. **Start here.** |
| `System-Flow.html` | Earlier version. Same content, but running straight down with the capabilities in a separate section at the bottom. |
