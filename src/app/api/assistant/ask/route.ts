import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { assistantAsk } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * The assistant.
 *
 * Chosen as the integration point because it was already authenticated through
 * `getActingUser` (which checks the live account, so a temporary-password
 * holder cannot reach it) and already permission-bound. It also had **zero UI
 * callers**, so replacing what sat behind it could not regress a single screen.
 *
 * ⚠ **That last part stopped being true in Phase 4.6.** `/assistant` calls it,
 * and sends a `conversationId` — which is what finally makes feature 07's
 * *"remembers earlier conversations"* run. The id is caller-supplied and
 * opaque on purpose; what stops one person reading another's history is the
 * actor check inside `ConversationStore`, not the id.
 *
 * Returns `{ answer, read, tools }`: the answer, the records it actually read,
 * and which tools it used. Reading is all it can do — there is no write tool in
 * the catalogue at all.
 */

export async function POST(request: Request) {
  // A read rather than a write, but it returns organisation data, so an account
  // still holding a temporary password should not reach it either.
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  let body: { message?: string; conversationId?: string };
  try {
    body = (await request.json()) as { message?: string; conversationId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "A message is required." }, { status: 422 });
  }

  // The answer AND the records behind it. A cited answer can be checked; an
  // uncited one has to be believed.
  const result = await assistantAsk(user.id, message, body.conversationId);
  return NextResponse.json(result);
}
