import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isInTheMeeting } from "@/domains/workplace/meeting-access";
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
      // The link travels only with the people on the meeting. Everyone can see
      // that a meeting exists — meetings carry no RBAC on purpose — but the
      // link is the way INTO the room, not a description of it, and anybody
      // holding it can walk in uninvited. Withheld rather than blanked: a
      // blanked field still announces that a link exists.
      link: isInTheMeeting(user.id, n.data as Record<string, unknown>)
        ? (n.data as { link?: string }).link
        : undefined,
    }));

  const people = directory().all().filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  return (
    <Shell>
      <header className="rise px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Your <span className="font-extrabold">meetings</span>
        </h1>
      </header>
      <MeetingsClient meetings={meetings} people={people} />
    </Shell>
  );
}
