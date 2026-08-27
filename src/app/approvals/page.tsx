import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { Shell } from "../shell";
import { ApprovalsClient } from "./approvals-client";

export const dynamic = "force-dynamic";

/**
 * The approvals inbox — the screen half of "voice prepares, a finger issues".
 *
 * Anything the assistant (chat or voice) prepared but may not complete itself
 * waits here for the signed-in person's own tap. Same endpoints as the voice
 * panel's proposal cards — never a second path.
 */
export default async function ApprovalsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <Shell>
      <ApprovalsClient />
    </Shell>
  );
}
