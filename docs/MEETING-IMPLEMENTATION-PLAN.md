# Meeting Feature — Implementation Plan

> **Feature:** Online meetings get a real Google Meet link, shared with either the
> selected attendees or everyone (creator's choice); in-person meetings book a room;
> outside people can be invited by email.
>
> **Status:** Planned — not started. Awaiting go-ahead.
> **Owner decisions (2026-08-22):** build UI/sharing now, connect real Google Meet
> as a second step · org uses **Google Workspace** (service-account path) ·
> creator **chooses selected-vs-everyone each time**.
>
> Companion file: [`MEETING-TRACKER.md`](./MEETING-TRACKER.md) (progress + DB checks).

---

## 1. Where things stand today

### Already built (backend ~90%)
- **`src/domains/workplace/meetings.ts`** — `meeting.create`, `meeting.update`,
  `meeting.addAttendee`, `meeting.cancel`.
  - `meeting.create` already: generates a link for `kind ∈ {online, both}` via the
    video provider, stores it **immutably** (`linkId` + `link`), notifies attendees
    (`publishedTo`), returns `{meetingId, linkId, link, busyAttendees}`.
  - `meeting.update` preserves the link across time/title edits.
  - `meeting.addAttendee` returns the link to the late-added person.
  - `meeting.cancel` calls `providers().video.cancelMeeting()` and marks cancelled.
  - The `MeetingData` shape **already declares** `roomId?`, `externals[]`, `linkId`,
    `link?` — the fields exist, they are just not populated from the UI.
- **`src/config/providers.ts`** — clean `VideoProvider` interface
  (`createMeeting`/`cancelMeeting`) with a `StubVideoProvider` returning a fake
  `https://meet.example/<title>` link. `createVideo()` switch keyed on
  `env().videoProvider` (only `"stub"` today).

### The two real gaps
1. **The link is fake.** A real `meet.google.com` link can only be minted by Google
   with credentials — addressed in **Phase 2**.
2. **The UI is thin.** `src/app/meetings/meetings-client.tsx` form has only
   title / kind / times / attendees. No share toggle, no room picker, no external
   emails, and the card shows no clickable **Join** button. `page.tsx` does not pass
   rooms, `roomId`, or `externals`.

---

## 2. Phase 1 — build now (no external dependency, fully testable)

### 2.1 Share choice — selected vs everyone
- **Domain** (`meetings.ts`): add arg `shareWith: "selected" | "everyone"`
  (default `"selected"`). In `execute`, when `"everyone"`, resolve attendees to all
  active people via `directory().all().filter(p => p.active)`; otherwise use the
  picked list. The link + notification then reach the right audience automatically
  (attendees drive `publishedTo`).
- **UI**: a two-button toggle (Selected / Everyone) on the create form, shown always.
- **Decision recorded:** "everyone" makes all active staff *attendees* (they are in
  the meeting and it shows on their day), not merely link-recipients — simplest model
  matching "invite everyone."

### 2.2 Join button + link surfaced everywhere
- **Card** (`meetings-client.tsx`): render a **Join** button that opens `m.link`
  in a new tab when a link exists (replaces the "link preserved" text note).
- **Notifications**: give `publishedTo` entries in `meeting.create` /
  `meeting.addAttendee` a `message` that includes the join link, so the bell shows it
  (the bus already renders `target.message ?? fallback`).
- **Day view**: ensure `link` is carried on the dashboard agenda meeting row
  (`src/app/api/today/route.ts` meeting mapping) so it appears on each person's day.

### 2.3 Room picker for in-person / both
- **UI**: a room `<select>` shown only when `kind ∈ {in-person, both}`; rooms passed
  from `page.tsx`.
- **Domain**: `meeting.create` already stores `roomId`. Additionally **book the room**
  (spec E7): when `roomId` is set, also write a `booking` for that room + window and
  **declare both writes to the gate** — `permission` returns
  `[{create meeting},{create booking}]` so the conformance harness stays satisfied.
  On a clash, surface the same `alternatives` path `room.book` uses
  (`src/domains/workplace/rooms.ts`). Card shows the room name.

### 2.4 External invitees by email
- **UI**: an "External emails" comma-separated input on the form.
- **Domain**: `meeting.create` already accepts `externals: [{email}]` — populate it.
  Card shows external-email badges marked "external".
- Actual email delivery is **stubbed in Phase 1** (same honesty as the link); real
  invites arrive free in Phase 2 via the Google Calendar event.

### 2.5 Page / client wiring
- **`src/app/meetings/page.tsx`**: pass `rooms` (id + name); include `roomId`,
  `externals`, `link` on each meeting object mapped for the client.
- **`src/app/meetings/meetings-client.tsx`**: form state gains `shareWith`, `roomId`
  (kind-conditional), `externals`; card gains the Join button, room name, external
  badges. Keep existing decisions / edit / cancel intact.

### 2.6 Files touched (Phase 1)
| File | Change |
|---|---|
| `src/domains/workplace/meetings.ts` | `shareWith`, everyone-resolution, room booking + dual permission, link in `publishedTo` message |
| `src/app/meetings/page.tsx` | pass rooms; map roomId/externals/link |
| `src/app/meetings/meetings-client.tsx` | share toggle, room select, external input, Join button, badges |
| `src/app/api/today/route.ts` | carry `link` on agenda meeting rows (if missing) |
| `src/domains/workplace/workplace.test.ts` | new assertions (see tracker) |
| `src/spine/conformance.test.ts` | meeting.create-with-room now writes a booking |

---

## 3. Phase 2 — connect real Google Meet (after Phase 1; needs your Google setup)

### 3.1 `GoogleMeetProvider` behind the existing interface
- Implement `VideoProvider` using **Google Calendar API `events.insert`** with
  `conferenceDataVersion=1` and
  `conferenceData.createRequest{ conferenceSolutionKey.type: "hangoutsMeet" }`.
  Returns a real `meet.google.com/...` link (`hangoutLink`).
  `cancelMeeting` deletes the event (ends the link). External emails become real
  Calendar invitees — Google delivers the invites automatically.
- Auth: **service account with domain-wide delegation** (Workspace) impersonating an
  org calendar/user.

### 3.2 Config
- `createVideo()` in `src/config/providers.ts` gains a `"google"` case.
- `.env`: `ORG_VIDEO_PROVIDER=google`, `GOOGLE_SA_JSON` (service-account key path/JSON),
  `GOOGLE_IMPERSONATE` (org calendar/user email). Stub stays the default for dev/tests.

### 3.3 Zero rebuild
- Interface unchanged ⇒ the moment the env is set, fake links become real. Everything
  in Phase 1 (Join button, notifications, sharing) works identically.

### 3.4 Setup guide (~20 min, to be provided at Phase 2)
1. Google Cloud project → enable **Google Calendar API**.
2. Create a **service account** + JSON key.
3. Google Workspace Admin → **domain-wide delegation**: authorize the service
   account's client ID with scope `https://www.googleapis.com/auth/calendar`.
4. Set the three env vars → restart. Verify with a test meeting.

---

## 4. Verification

- **Phase 1:** `npm run lint && npm run typecheck && npx vitest run` + `npm run build`;
  preview E2E (robocopy → `E:\MS\.n1-preview`, `ORG_SEED_DEMO=true`, port 3001,
  Playwright):
  - create online meeting → Join button + link in each attendee's bell;
  - toggle **Everyone** → all active staff become attendees;
  - in-person + room → room shown and a `booking` exists (double-book refused);
  - external email → badge shown; cancel → link gone.
- **Phase 2:** with service-account creds in a throwaway env, create a meeting → a real
  `meet.google.com` link returns and opens; cancel removes the Google event.
- **No commit/push without explicit permission** (standing rule).

---

## 5. Risks / notes
- Room double-booking: reuse `rooms.ts` clash logic — do **not** invent a second
  availability check.
- Conformance harness will FAIL loudly if `meeting.create` writes a booking without
  declaring it — that is by design; update the declaration in the same change.
- "Everyone" on a large org means many attendees + notifications; fine at current
  scale, revisit if staff count grows large.
- Phase 2 email invites depend entirely on the Google path — no separate email
  provider is introduced.
