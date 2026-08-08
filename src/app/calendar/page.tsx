import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { monthView } from "@/domains/workplace/calendar";
import { Shell } from "../shell";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function CalendarPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const year = 2026;
  const month = 8;
  const cells = monthView(getWorld().deps.graph, year, month);
  const firstDow = new Date(year, month - 1, 1).getDay();

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          {MONTHS[month - 1]} {year}
        </h1>
      </header>
      <div className="p-6">
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((d) => (
            <div key={d} className="pb-2 text-center text-xs font-medium uppercase tracking-wide text-zinc-400">
              {d}
            </div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {cells.map((cell, i) => {
            const day = i + 1;
            const hasMeetings = cell.meetings > 0;
            const hasEvents = cell.events.length > 0;
            return (
              <div
                key={day}
                className={`min-h-20 rounded-lg border p-2 ${
                  hasMeetings || hasEvents
                    ? "border-black/[.1] bg-white dark:border-white/[.15] dark:bg-black"
                    : "border-transparent"
                }`}
              >
                <div className="text-xs font-medium text-zinc-400">{day}</div>
                {hasMeetings && (
                  <div className="mt-1 flex gap-0.5">
                    {Array.from({ length: Math.min(cell.meetings, 5) }).map((_, j) => (
                      <div key={j} className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                    ))}
                  </div>
                )}
                {cell.events.map((e) => (
                  <div key={e.id} className="mt-1 truncate text-xs font-medium text-amber-600">
                    {e.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
