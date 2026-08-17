import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
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
        (id) => directory().nameOf(id),
      ),
      link: (n.data as { link?: string }).link,
    }));

  const rooms = (await deps.graph.find("room", () => true)).map((n) => ({
    id: n.id,
    name: (n.data as { name?: string }).name ?? n.id,
  }));

  const people = directory().all().filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  return (
    <Shell>
      <header className="rise px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Your <span className="font-extrabold">meetings</span>
        </h1>
      </header>
      <MeetingsClient meetings={meetings} rooms={rooms} people={people} />
    </Shell>
  );
}
