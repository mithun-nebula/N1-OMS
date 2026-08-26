import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { assistantConversationId } from "@/server/conversation-id";
import { Shell } from "../shell";
import { AssistantClient } from "./assistant-client";

/**
 * The assistant, on a screen.
 *
 * `/api/assistant/ask` has existed since Phase 1a and had **zero UI callers** —
 * which is why feature 07's *"remembers earlier conversations"* has never once
 * run in this product. The history mechanism, its store, its actor check and
 * its tests were all built and then reached by nothing.
 *
 * ⚠ **The conversation id is computed here, on the server, not in the
 * browser.** A `localStorage` id would be stable per *device*, and "follows you
 * between phone and computer" is the whole feature. See
 * `server/conversation-id.ts` for why it is also not simply the actor id.
 */
export default async function AssistantPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // The tools read through the demo world's spine; make sure it has hydrated
  // before the first question can be asked, the same as /messages does.
  await getWorld();

  return (
    <Shell>
      <AssistantClient
        conversationId={assistantConversationId(user.id)}
        selfName={user.displayName}
      />
    </Shell>
  );
}
