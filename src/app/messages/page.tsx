import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { Shell } from "../shell";
import { MessagesClient } from "./messages-client";

export default async function MessagesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // The directory hydrates inside buildDemoWorld — make sure it ran before
  // the client asks /api/messages for the sidebar.
  await getWorld();

  return (
    <Shell>
      <MessagesClient selfId={user.id} selfName={user.displayName} />
    </Shell>
  );
}
