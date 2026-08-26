import { createHmac } from "node:crypto";
import { env } from "@/config/env";
import type { ActorId } from "@/spine/operation/types";

/**
 * The assistant's conversation id, for one person.
 *
 * Feature 07 promises a conversation that *"follows you between phone and
 * computer"*. That rules out the two obvious ways to make an id:
 *
 *  - **Generated in the browser** (`crypto.randomUUID` into `localStorage`) —
 *    stable per *device*, which is the opposite of the promise. A phone and a
 *    desk would hold two conversations that never meet.
 *  - **The actor id itself** — stable everywhere, and the trap
 *    `phases/phase 4.6/implementation-plan.md` names: the id is caller-supplied
 *    and opaque, so an id that reads `assistant:priya` is a guess away from
 *    naming somebody else's row.
 *
 * So it is **derived from the actor under the server's own key**. Same person,
 * same id, every device, forever — and nothing guessable about them survives
 * into the string. `hr-004` and `priya` are not recoverable from `c-9f3a…`, and
 * a second person cannot construct one without the secret.
 *
 * ⚠ **This is not the safety boundary and must never be treated as one.** What
 * stops one person reading another's conversation is the actor check in
 * `ConversationStore.historyFor` / `append` — which returns `[]` rather than an
 * error, per non-negotiable #2. Unguessability is a second lock on the same
 * door, not the door. A leaked id still gets an empty history.
 */
export function assistantConversationId(actor: ActorId): string {
  const digest = createHmac("sha256", env().authSecret)
    // Domain separation: the session token HMACs a JSON payload under the same
    // key, and two different things signed by one key must not be able to
    // collide into each other's namespace.
    .update(`assistant-conversation:${actor}`)
    .digest("base64url");
  return `c-${digest.slice(0, 32)}`;
}
