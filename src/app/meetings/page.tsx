import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";
import { MeetingsClient } from "./meetings-client";

export default async function MeetingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();

  const meetings = (await deps.graph
    .find("meeting", (n) => (n.data as { cancelled?: boolean }).cancelled !== true))
    .map((n) => ({
      id: n.id,
      title: (n.data as { title?: string }).title ?? n.id,
      kind: (n.data as { kind?: string }).kind ?? "online",
      from: (n.data as { from?: string }).from,
      to: (n.data as { to?: string }).to,
      attendees: ((n.data as { attendees?: string[] }).attendees ?? []).map(
        (id) => DEMO_PEOPLE[id]?.name ?? id,
      ),
      link: (n.data as { link?: string }).link,
    }));

  const rooms = (await deps.graph.find("room", () => true)).map((n) => ({
    id: n.id,
    name: (n.data as { name?: string }).name ?? n.id,
  }));

  const people = Object.entries(DEMO_PEOPLE).map(([id, p]) => ({ id, name: p.name }));

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Meetings</h1>
      </header>
      <MeetingsClient meetings={meetings} rooms={rooms} people={people} />
    </Shell>
  );
}
