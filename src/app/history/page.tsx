import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { Shell } from "../shell";
import { HistoryClient } from "./history-client";

export const dynamic = "force-dynamic";

/**
 * Your own days, looked back over — the screen behind /api/today/history.
 *
 * Strictly personal (appendix A9): the streak and the run of days behind it
 * are never shown to a manager or the team. This page only ever asks for the
 * signed-in person's own history.
 */
export default async function HistoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <Shell>
      <HistoryClient />
    </Shell>
  );
}
