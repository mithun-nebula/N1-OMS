import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { monthView } from "@/domains/workplace/calendar";
import { directory } from "@/server/directory";
import { Shell } from "../shell";
import { CalendarClient } from "./calendar-client";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const now = new Date();
  const params = await searchParams;
  const year = params.year ? Number(params.year) : now.getFullYear();
  const month = params.month ? Number(params.month) : now.getMonth() + 1;

  const graph = (await getWorld()).deps.graph;
  const cells = await monthView(graph, year, month);
  const firstDow = new Date(year, month - 1, 1).getDay();

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const entries = (await graph
    .find("calendar-entry", (n) => {
      const d = n.data as { date?: string };
      return Boolean(d.date?.startsWith(prefix));
    }))
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      const peopleIds = Array.isArray(d.people) ? (d.people as string[]) : [];
      return {
        id: n.id,
        title: String(d.title ?? n.id),
        kind: String(d.kind ?? "meeting"),
        date: String(d.date ?? ""),
        from: d.from ? String(d.from) : undefined,
        to: d.to ? String(d.to) : undefined,
        detail: d.detail ? String(d.detail) : undefined,
        peopleIds,
        people: peopleIds.map((id) => directory().nameOf(id)),
        cancelled: Boolean(d.cancelled),
      };
    });

  const people = directory().all().filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return (
    <Shell>
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          {MONTHS[month - 1]} {year}
        </h1>
        <div className="flex gap-2">
          <a href={`/calendar?year=${prevYear}&month=${prevMonth}`} className="rounded-lg border border-black/[.1] px-3 py-1 text-sm text-zinc-600 hover:bg-black/[.04] dark:border-white/[.2] dark:text-zinc-300">
            ← {MONTHS[prevMonth - 1]}
          </a>
          <a href={`/calendar?year=${nextYear}&month=${nextMonth}`} className="rounded-lg border border-black/[.1] px-3 py-1 text-sm text-zinc-600 hover:bg-black/[.04] dark:border-white/[.2] dark:text-zinc-300">
            {MONTHS[nextMonth - 1]} →
          </a>
        </div>
      </header>
      <CalendarClient
        year={year}
        month={month}
        days={DAYS}
        firstDow={firstDow}
        cells={cells}
        entries={entries}
        people={people}
      />
    </Shell>
  );
}
