import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getConversationStore } from "@/server/runtime";
import { assistantConversationId } from "@/server/conversation-id";

export const dynamic = "force-dynamic";

/**
 * The transcript so far, so a reopened tab shows what a returning person
 * already said rather than a blank page.
 *
 * ⚠ **The id is derived here from the session, not taken from the query.** The
 * ask route accepts a caller-supplied id because it always has, and the actor
 * check makes that safe. This route has no such history and no reason to start
 * one: there is exactly one conversation a person can ask for — their own — so
 * an id parameter would be a lock with nothing behind it.
 *
 * Only `{role, content}` ever reaches the browser. Tool calls, tool results and
 * citations are not in the row at all — see the header of
 * `domains/assistant/conversation.ts`, and `phases/phase 2.5/outcome.md:783`
 * for why that is deliberate and stays that way.
 */
export async function GET() {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const actor = auth.user.id;
  const id = assistantConversationId(actor);
  const store = await getConversationStore();
  // Returns [] for a conversation that is not this actor's — empty, never an
  // error, because a refusal must not disclose that a record exists.
  const history = await store.historyFor(id, actor);

  const turns = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
    }))
    .filter((m) => m.content.length > 0);

  return NextResponse.json({ conversationId: id, turns });
}
