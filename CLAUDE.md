# CLAUDE.md — Organization A spine

Project conventions live in **`AGENTS.md`** — commands, the throwaway-database
rule, local-time handling, the undo-plan ratchet. Read that first; this file
carries only what is specific to the model layer, because those failure modes
are **silent rather than loud** and no amount of care at the call site catches
them after the fact.

---

## Vercel AI SDK v7

### 1 · Never pass a bare string as `model`

```ts
model: 'google/gemini-3.1-flash-lite'          // ❌ compiles. Wrong provider.
model: vertex('gemini-3.1-flash-lite')         // ✅
```

The bare-string form routes through the **Vercel AI Gateway** — the SDK's
default global provider, and the form used in nearly every example on their
docs. It typechecks, it **ignores your service-account credentials entirely**,
and when deployed on Vercel it may *silently succeed and bill there instead*.
The application works; the provider is wrong; nothing tells you.

This is the single highest-probability mistake in the model layer. The import
must be:

```ts
import { vertex } from '@ai-sdk/google-vertex';
```

**`@ai-sdk/google` is a different package** — the AI Studio API-key provider. It
cannot use a service account. This project authenticates with a service account
on a paid Google Cloud project, so it is always `@ai-sdk/google-vertex`.

There is a test that greps for the bare-string form. Do not weaken it.

### 2 · `import { z } from 'zod'` is correct here

Some agent frameworks (Genkit) require their own re-exported `z`. This project
does not. Plain `zod`, which is already a dependency.

### 3 · Register `@ai-sdk/otel` at startup, and assert it

Forgetting produces **silence, not an error**. This project has no other
observability, and the model is the first metered, variable-latency dependency
it has ever had — an untraced one is undebuggable.

### 4 · Put a constraint in the tool result, not the system prompt

A constraint in the **tool result** is obeyed. The same constraint in the
**system prompt** is obeyed less. Put it where the model is looking at the
moment it matters.

Phase 2 proved this three times on one live day, and once by counter-example:

| Constraint | Where it was put | What happened |
|---|---|---|
| don't re-decide the miss verdict | a `note` beside `missKind` in the payload | reported the verdict, added no judgement of its own |
| this required document is absent | `required_documents` names its own absence | obeyed |
| carrying over doesn't make the day clean | `dayStillCounted: false` | obeyed, and worded right unprompted |

The counter-example is what makes it a rule rather than a preference.
`{ ok: false }` **alone was not enough** — the model read a refusal and wrote
*"I've added Module 4 (60 minutes) to your plan."* Adding `didNotHappen: true`
and a `tellThem` sentence **to that same payload** fixed it immediately.

```ts
return { ok: false }                                    // ❌ narrated as success
return { ok: false, didNotHappen: true,                 // ✅
         tellThem: `This did NOT happen: ${reason} Say so plainly.` }
```

So the signal has to be **loud**, not merely present. `refused()` in
`tools/day-write.ts` is the shape to copy.

**Why this is here and not only in a phase log.** Phase 3 wraps 59 operations,
each with rules the model must not override — who may approve, what parks, what
cannot be undone. Those belong in the tool result. A system prompt that grows a
paragraph per operation is paid for on **every single call** and works less well
than one sentence returned at the moment it applies.

### v7 renames

A session working from older knowledge writes v6 idioms. Most of these fail
loudly; the gateway string above does not.

| v6 | v7 |
|---|---|
| `new Agent(...)` | `new ToolLoopAgent(...)` — `Agent` is now an interface |
| `system:` | `instructions:` |
| `maxSteps: n` | `stopWhen: isStepCount(n)` — `maxSteps` does not exist |
| `onFinish` / `onStepFinish` | `onEnd` / `onStepEnd` |
| `experimental_telemetry` | `telemetry`, via `@ai-sdk/otel` |
| `parameters:` on a tool | `inputSchema:` |

Tools are a **record keyed by name** (`{ listLeave }`), not an array. The key is
the name; there is no `name` field.

---

## The rule the assistant stands on

**The actor is never a tool parameter.**

It comes from the signed-in session and reaches `execute` out of band. It must
be impossible for the model to name an actor — otherwise a prompt-injected leave
reason saying *"look up the admin's pay"* would work.

```ts
inputSchema: z.object({ actor: z.string() })   // ❌ catastrophic
inputSchema: z.object({ name: z.string() })    // ✅ actor comes from context
```

There is a grep test for this too:
`grep -rn "actor: z\." src/domains/assistant/tools/` must return nothing.

Every tool wraps an **existing permission-bound read** (`spine.read` /
`spine.readMany` and the services above them). Nothing in the assistant touches
the graph directly. That is the whole safety argument: an agent built only on
those cannot surface something its user could not already open — not by
instruction, by construction.

---

## Provider seam

`src/config/providers.ts` is the switch, on `ORG_LLM_PROVIDER`:

| | |
|---|---|
| `stub` | **throws — and is the default**, so no test can reach the network |
| `dev` | echo, for local poking |
| `fake` | canned tool calls; what the tests use |
| `vertex` | real, via `vertex()` from `@ai-sdk/google-vertex` |

`resetProviders()` exists for tests.

**Every model call follows `course/service.ts:generateDeck`:** try the provider,
fall back to something deterministic, and report which path ran
(`source: "llm" | "heuristic"`). Feature 03 promises the manual screens always
remain available, and that promise doubles as the outage plan.

### Credentials

The service-account JSON lives **outside this repository**. `.gitignore` covers
`.env*` and `*.pem` but **not `*.json`** — a key dropped in the repo will be
committed, and a leaked service-account key on a paid project stays usable until
somebody notices. Only the *path* ever appears in `.env`.

`next.config.ts` must carry:

```ts
serverExternalPackages: ['google-auth-library', 'gaxios']
```

Vertex authenticates through `google-auth-library`, which Next otherwise tries
to bundle and fails on, with an error that looks nothing like an auth problem.
