import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
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

  const people = directory().all().filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  return (
    <Shell>
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Org <span className="font-extrabold">events</span>
        </h1>
        <p className="w-full text-sm text-ink-soft">Proposal → live → closing report</p>
      </header>
      <EventsClient events={events} people={people} actorId={user.id} />
    </Shell>
  );
}
