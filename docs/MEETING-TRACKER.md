# Meeting Feature — Tracker

> Progress + database checks for the meeting feature.
> Plan: [`MEETING-IMPLEMENTATION-PLAN.md`](./MEETING-IMPLEMENTATION-PLAN.md).
>
> **Legend:** ⬜ not started · 🟡 in progress · ✅ done · ⛔ blocked
> Update the Status column and the Notes as work proceeds.

---

## A. Phase 1 — build now (UI + sharing, no external deps)

| # | Task | File(s) | Status | Notes |
|---|---|---|---|---|
| 1.1 | `shareWith: "selected" \| "everyone"` arg + everyone→all-active resolution | `src/domains/workplace/meetings.ts` | ⬜ | default "selected" |
| 1.2 | Share toggle (Selected / Everyone) on create form | `meetings-client.tsx` | ⬜ | two-button pill |
| 1.3 | Join button on meeting card (opens `m.link`) | `meetings-client.tsx` | ⬜ | only when link exists |
| 1.4 | Join link inside notification `message` | `meetings.ts` (`publishedTo`) | ⬜ | create + addAttendee |
| 1.5 | Carry `link` on dashboard agenda row | `src/app/api/today/route.ts` | ⬜ | verify if already present |
| 1.6 | Room `<select>` shown for in-person/both | `meetings-client.tsx`, `page.tsx` | ⬜ | rooms passed from page |
| 1.7 | `meeting.create` books the room + declares both writes | `meetings.ts` | ⬜ | reuse `rooms.ts` clash logic |
| 1.8 | External emails input + badges | `meetings-client.tsx`, `page.tsx` | ⬜ | email send stays stubbed |
| 1.9 | Page wiring: pass rooms, map roomId/externals/link | `src/app/meetings/page.tsx` | ⬜ | |
| 1.10 | Tests: link, everyone, room-booking, externals, cancel | `workplace.test.ts` | ⬜ | see section C |
| 1.11 | Conformance: meeting.create-with-room writes a booking | `conformance.test.ts` | ⬜ | add to battery + declaration |

**Phase 1 gate:** lint ✅ · typecheck ✅ · vitest ✅ · build ✅ · preview E2E ✅ → then request commit.

---

## B. Phase 2 — real Google Meet (after Phase 1; needs Google setup)

| # | Task | File(s) | Status | Notes |
|---|---|---|---|---|
| 2.1 | `GoogleMeetProvider` (Calendar API + service account) | `src/config/providers.ts` (+ new module) | ⬜ | behind existing `VideoProvider` |
| 2.2 | `createVideo()` gains `"google"` case | `src/config/providers.ts` | ⬜ | stub stays default |
| 2.3 | Env: `ORG_VIDEO_PROVIDER`, `GOOGLE_SA_JSON`, `GOOGLE_IMPERSONATE` | `.env`, `src/config/env.ts` | ⬜ | user provides creds |
| 2.4 | Google Cloud setup (guide) — Calendar API, SA key, domain-wide delegation | (external, user) | ⬜ | ~20 min |
| 2.5 | Verify a real `meet.google.com` link end-to-end | throwaway env | ⬜ | + cancel removes event |

---

## C. Test checklist (what "done" means)

- [ ] Online meeting create → non-empty `link` returned and stored on the node.
- [ ] `shareWith:"everyone"` → attendees == all active staff.
- [ ] `shareWith:"selected"` → attendees == picked list only.
- [ ] In-person/both with `roomId` → a `booking` node exists for that room+window.
- [ ] Booking clash → alternatives surfaced (not a hard failure), same as `room.book`.
- [ ] Externals stored on the meeting; badges render.
- [ ] `meeting.cancel` → `cancelled:true` and video `cancelMeeting` called.
- [ ] Late add (`meeting.addAttendee`) → link delivered to the new person.
- [ ] Conformance battery green (meeting+booking both declared).
- [ ] Each attendee's notification carries the join link.

---

## D. DATABASE CHECKS — is the DB fine for this feature?

### D.1 Verdict (Phase 1): ✅ NO schema change needed

Meetings and bookings are **not their own tables** — they are rows in the single
`orga_nodes` table, keyed by `type`:

```
orga_nodes ( type text, id text, data jsonb, version int, updated_at timestamptz,
             PRIMARY KEY (type, id) )   -- index on (type)
orga_edges ( from_id, to_id, type, data, created_at )   -- relationships
```

Every new field this feature adds — `shareWith`, `roomId`, `externals`, `link`,
`linkId` — lives **inside the JSONB `data` column**. Adding JSON keys needs **no
migration, no ALTER TABLE, no new table**. A `booking` created alongside a meeting is
just another `orga_nodes` row with `type='booking'`. **The DB is fine as-is.**

Phase 2 (Google) adds only **env vars** — still no DB change.

### D.2 Manual DB verification (run against the live DB when testing)

> Read-only checks. Safe to run. Replace nothing destructive.

```sql
-- 1. The nodes table exists and holds meetings/bookings/rooms
SELECT type, count(*) FROM orga_nodes
 WHERE type IN ('meeting','booking','room') GROUP BY type;

-- 2. A freshly created online meeting stored its link + share choice
SELECT id,
       data->>'kind'      AS kind,
       data->>'shareWith' AS share_with,
       data->>'link'      AS link,
       data->>'roomId'    AS room_id,
       jsonb_array_length(coalesce(data->'attendees','[]')) AS attendees,
       jsonb_array_length(coalesce(data->'externals','[]')) AS externals
  FROM orga_nodes
 WHERE type='meeting'
 ORDER BY updated_at DESC
 LIMIT 5;

-- 3. In-person/both meeting produced a booking (no orphan room hold)
SELECT m.id AS meeting, m.data->>'roomId' AS room_id,
       b.id AS booking, b.data->>'from' AS b_from, b.data->>'to' AS b_to
  FROM orga_nodes m
  LEFT JOIN orga_nodes b
    ON b.type='booking' AND b.data->>'roomId' = m.data->>'roomId'
   AND b.data->>'from' = m.data->>'from'
 WHERE m.type='meeting' AND m.data->>'kind' IN ('in-person','both')
 ORDER BY m.updated_at DESC LIMIT 5;

-- 4. Cancelled meetings are marked, not deleted (history kept)
SELECT id, data->>'cancelled' AS cancelled
  FROM orga_nodes WHERE type='meeting' AND data ? 'cancelled' LIMIT 5;

-- 5. No booking points at a room that doesn't exist (referential sanity)
SELECT b.id AS booking, b.data->>'roomId' AS room_id
  FROM orga_nodes b
 WHERE b.type='booking'
   AND NOT EXISTS (
     SELECT 1 FROM orga_nodes r
      WHERE r.type='room' AND r.id = b.data->>'roomId');
```

### D.3 DB-check pass criteria

- [ ] Query 1 returns rows (tables exist, seed present).
- [ ] Query 2 shows `link` non-null for online/both, `shareWith` set, attendee/external counts correct.
- [ ] Query 3 pairs each in-person meeting with a booking (no NULL booking).
- [ ] Query 4 shows cancels as a flag, records retained.
- [ ] Query 5 returns **zero rows** (no dangling room references).

### D.4 Data-integrity notes / watch-items
- **No FK enforcement** — relationships are app-level (spine + `orga_edges`), so
  Query 5 is the manual stand-in for a foreign key. Confirm it stays empty.
- **JSONB is schemaless** — a typo'd field name won't be rejected by Postgres; the
  operation `validate()` + the conformance test are the guards. Keep both green.
- **Durability** — meetings/bookings persist in Postgres automatically (same store as
  everything else); no separate durable-store work like chat/day-plan needed.

---

## E. Open questions / decisions log

| Date | Question | Decision |
|---|---|---|
| 2026-08-22 | Build order | UI/sharing now; real Google Meet as Phase 2 |
| 2026-08-22 | Google auth model | Workspace **service account** (domain-wide delegation) |
| 2026-08-22 | Who gets the link | Creator chooses **selected or everyone** each time |
| 2026-08-22 | What "everyone" means | All active staff become **attendees** (not just link-recipients) |
| — | _(add doubts / changes here as they come up)_ | |
