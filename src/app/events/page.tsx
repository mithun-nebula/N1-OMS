import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";
import { EventsClient } from "./events-client";

export default async function EventsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();

  const events = (await deps.graph.find("event", () => true)).map((n) => {
    const d = n.data as Record<string, unknown>;
    return {
      id: n.id,
      title: String(d.title ?? n.id),
      date: String(d.date ?? ""),
      status: String(d.status ?? "planning"),
      capacity: d.capacity as number | undefined,
      tasks: Array.isArray(d.tasks) ? (d.tasks as Array<Record<string, unknown>>) : [],
      registrations: Array.isArray(d.registrations) ? (d.registrations as string[]) : [],
      budget: d.budget as { spent: number; limit?: number } | undefined,
      report: d.report ? String(d.report) : undefined,
    };
  });

  const people = Object.entries(DEMO_PEOPLE).map(([id, p]) => ({ id, name: p.name }));

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Events</h1>
        <p className="text-sm text-zinc-400">Proposal → live → closing report</p>
      </header>
      <EventsClient events={events} people={people} actorId={user.id} />
    </Shell>
  );
}
