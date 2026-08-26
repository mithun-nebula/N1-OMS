import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { openProposals } from "@/server/voice/tap";

export const dynamic = "force-dynamic";

/**
 * What is prepared and waiting for the signed-in person to tap.
 *
 * **Voice prepares. A finger issues.** The voice session pushes a proposal down
 * its own socket the moment one is made, but a person who reloaded the page, or
 * who prepared something in chat, still has to be able to find it. This is that
 * list.
 *
 * Always the caller's own — `openProposals` takes the actor from the session
 * and there is no parameter for whose proposals these are.
 */
export async function GET() {
  const auth = await getActingUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ proposals: openProposals(auth.user.id) });
}
