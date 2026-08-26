# Building the UI without breaking voice

> **Read this before touching the app shell, `package.json`, or `public/`.**
>
> Voice was built in Phase 6 and works end to end. Most of it is server-side and
> does not care what the UI looks like. But it has **five load-bearing pieces in
> the front end and the build**, and every one of them fails *silently* — the app
> builds, every test passes, every screen works, and voice is simply not there.
>
> That is the whole reason this file exists. Nothing here will shout at you.

---

## The five things

| # | Do not break | If you do |
|---|---|---|
| 1 | `"start": "tsx server.ts --prod"` in `package.json` | voice vanishes in production |
| 2 | `<VoiceButton />` in the app shell | no way to start a conversation |
| 3 | `public/voice-worklet.js` | the microphone fails when tapped |
| 4 | the upgrade fence in `src/server/voice/attach.ts` | sockets die ~30ms after connecting |
| 5 | WebSocket support at your host/proxy | voice never connects once deployed |

---

## 1 · `npm start` is not `next start`

```json
"dev":      "tsx server.ts",        // use this
"dev:next": "next dev",             // NO VOICE — plain Next, for UI work only
"start":    "tsx server.ts --prod"  // production
```

**Why.** A Next App Router route handler returns a `Response`. **It never sees
the HTTP upgrade** — Next's own HTTP layer consumes it before any route runs. So
`server.ts` wraps Next: it hands every ordinary request to Next's handler and
owns the `upgrade` event itself.

`next start` will serve every screen perfectly. Voice will just be gone.

⚠ `--prod` rather than `NODE_ENV=production` in the script, because that is
shell syntax Windows does not have and this is developed on Windows.

**`npm run dev:next` exists on purpose.** If you are working on layout and do not
care about voice, it is faster. Just do not ship it.

---

## 2 · Keep the button mounted

```tsx
// src/app/shell-client.tsx
import { VoiceButton } from "./voice-session";
...
<VoiceButton />
```

If you rebuild the shell, carry it across. It renders its own floating button
and panel and needs no props.

**It must be inside the signed-in shell.** The socket authenticates from the
session cookie, so it is useless on a public page.

---

## 3 · `public/voice-worklet.js` is not dead code

Nothing imports it, so every "unused file" sweep will want to delete it. It is
fetched **by URL at runtime**:

```ts
await audio.audioWorklet.addModule("/voice-worklet.js");   // voice-session.tsx
```

An AudioWorklet runs in its own realm and cannot be a bundled import. If you
move it, update that path. The processor name (`mic-capture`) is also matched by
string at both ends.

**Why a worklet at all:** `MediaRecorder` produces webm/opus containers and the
model wants raw PCM; `ScriptProcessorNode` produces the right samples but runs on
the main thread and glitches every time React renders — which, for a panel
showing a live transcript, is constantly.

---

## 4 · ⚠ The upgrade fence — the subtlest of the five

`src/server/voice/attach.ts` ends with `fenceOffNextsUpgradeHandler`. **Do not
remove it, and do not "simplify" it.**

**What it defends against.** Next's `getRequestHandler()` attaches **its own**
`upgrade` listener — lazily, on the first HTTP request it serves, to
`req.socket.server`, which is our server even though Next was never handed it.
That handler matches `/api/voice` against the route table and calls
`socket.end()`.

The result is a socket that completes its handshake, fires `open`, and dies a few
milliseconds later with **code 1006, no close frame, no error, and nothing in any
log.** And only ever *after a page has been loaded*, which is why:

```
  server.listenerCount("upgrade") at startup    ->  1, ours.        Looks fine.
  a socket opened BEFORE any page load          ->  works.          Looks fine.
  every test against a bare http.Server         ->  passes.         Looks fine.
  a real browser, where a page load comes first ->  NEVER WORKS.
```

This cost hours to find. `upgrade.test.ts` has a regression test that registers a
hostile listener *after* ours — verified to fail without the fence.

**Related:** `src/app/api/voice/route.ts` returns **426 Upgrade Required** with an
explanation. It is not the socket and cannot be. Keep it so anyone opening
`/api/voice` in a browser learns why, rather than getting a 404 that suggests
voice is missing.

---

## 5 · Your host must allow WebSockets

Most proxies block them by default.

**Google Cloud**
- **Cloud Run** — works. **Raise the request timeout above the default 5 minutes**
  (~35 is right; sessions self-close at 30). A voice call is one long request, so
  the default cuts it off mid-conversation.
- **App Engine Standard** — does **not** support WebSockets. Do not use it.
- Compute Engine / GKE — fine.

**nginx / Cloudflare** — pass `Upgrade` and `Connection` headers through.

You do **not** need session affinity: prepared proposals live in Postgres
(`orga_proposals`), so a tap can land on any instance.

---

## What you can freely change

- Every screen, layout, component and style
- The panel's appearance (`src/app/voice-session.tsx` renders its own)
- Anything under `src/app/**` that is not the shell mount

The relay, the tool bridge, the gate, the propose rule and the read-back are all
server-side and independent of the UI.

---

## Optional: let a page say what it is showing

Voice already works without this. Say *"book Hall 2 for Tuesday at three"* and it
books it — the session sends the person's rooms and equipment when it opens
(permission-filtered), so it knows what exists.

This is only for **lazy words** — "that room", "approve it", "this one":

```tsx
<div data-record-type="room" data-record-id="hall-2">
```

Add it to detail pages as you build them. One line each, entirely optional, and
**no page sets it today**.

Two rules it obeys, and the second matters:

1. The id is resolved through `spine.read` on the server and **dropped if the
   read refuses** — being on a page is not permission to see what is on it, and a
   deep link can be typed by anybody.
2. It is a **hint, never an instruction**. It reaches the model as prose, never
   as a tool argument. *"That room"* resolves to Hall 2; *"approve it"* with a
   leave request on screen **still proposes**. Context may fill a blank; it may
   never skip a gate.

⚠ Say the **verb**. *"Book Hall 2 for Tuesday"* works; *"I need a room on
Tuesday"* went to the wrong specialist in live testing, because with no verb it
has to guess which area you mean.

---

## If a proposal reaches the screen

Money and people **cannot be completed by voice** — `approve_proposal` is not in
the live tool set at all, so there is nothing for the model to call. The proposal
appears in the panel with **Approve** and **Discard**, backed by:

```
GET    /api/proposals          what is waiting for the signed-in person
POST   /api/proposals/{id}     approve, under their own hand
DELETE /api/proposals/{id}     discard
```

If you surface proposals anywhere else in your UI, use these endpoints. Do not
build a second path: the tap is submitted through the same `Spine.submit`, the
same gate and the same activity log as everything else, and `take` is a single
`DELETE ... RETURNING` so one prepared approval cannot be submitted twice.

---

## Environment

```
GOOGLE_VERTEX_LIVE_MODEL      default gemini-live-2.5-flash-native-audio
GOOGLE_VERTEX_LIVE_LOCATION   default us-central1
```

⚠ **Separate from `GOOGLE_VERTEX_MODEL` / `GOOGLE_VERTEX_LOCATION` on purpose.**
Chat runs on `global`; the live model is not served there. Pointing them at one
value would mean moving chat to make voice work.

---

## How to tell whether voice actually works

Not from the build, and not from the tests. Both pass with voice completely dead.

1. `npm run build && npm start`
2. Sign in, tap the ✦ button, allow the microphone
3. Say **"what's on my day today?"**

You should see the state go **Listening → Thinking → Speaking**, your words
appear as text in the panel, and hear a spoken answer.

If the panel jumps straight to **Ended**, it is one of the five above — start
with #1 and #4.

---

## Still to be done by a person

The one thing nobody has tested: **a real human at a real microphone.** All live
testing used recorded speech played into Chrome as a fake device, which proves the
plumbing and proves nothing about a real room.

Specifically worth doing:

- **Cough, or half-say a word, where a "yes" would go.** It must not be taken as
  consent. It held against synthesised non-speech; the half-word that *almost*
  parses is the case the design actually fears.
- Background noise, an accent, someone talking over you, a bad headset.
- **Names are the known weak spot** — "Naveen" came back as Navin, Neveen and
  Navine, never once correctly. Nothing acted on a mishearing (a wrong name finds
  no record and it asks), but that holds because no two people here sound alike.
  In an organisation with a Naveen *and* a Navin, nothing in this codebase would
  catch it. The on-screen transcript is the only defence, and it depends on
  somebody looking.

See `phases/phase 6/outcome.md` for the full record.
