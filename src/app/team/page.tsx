import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { isRestricted } from "@/spine/permission/types";
import { Shell } from "../shell";

export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = getSpine();
  const graph = getWorld().deps.graph;

  const visiblePeople = Object.entries(DEMO_PEOPLE)
    .map(([id, person]) => {
      const read = spine.read({ actor: user.id, nodeType: "employee", nodeId: id });
      if (!read.found) return null;
      return { id, person, record: read.record };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const coursesByOwner = new Map<string, Array<{ title: string; pct: number }>>();
  for (const course of graph.find("course", () => true)) {
    const owner = (course.data as { owner?: string }).owner;
    if (!owner) continue;
    const figs = graph.getNode("course", course.id)
      ? getWorld().deps.figures.forRecord("course", course.id, "Course completion")
      : [];
    const pct = figs.length > 0 ? Number(figs[figs.length - 1].value) : 0;
    const list = coursesByOwner.get(owner) ?? [];
    list.push({ title: (course.data as { title?: string }).title ?? course.id, pct });
    coursesByOwner.set(owner, list);
  }

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Team</h1>
      </header>
      <div className="space-y-6 p-6">
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Directory</h2>
          <div className="overflow-hidden rounded-xl border border-black/[.08] dark:border-white/[.12]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.08] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Pay</th>
                </tr>
              </thead>
              <tbody>
                {visiblePeople.map(({ id, record }) => {
                  const pay = record.pay;
                  return (
                    <tr key={id} className="border-b border-black/[.04] last:border-0 dark:border-white/[.04]">
                      <td className="px-4 py-2 font-medium text-black dark:text-zinc-50">{String(record.name ?? "")}</td>
                      <td className="px-4 py-2 text-zinc-500">{String(record.role ?? "")}</td>
                      <td className="px-4 py-2 text-zinc-500">{String(record.contact ?? "")}</td>
                      <td className="px-4 py-2">
                        {isRestricted(pay) ? (
                          <span className="text-xs text-zinc-400">🔒 Restricted</span>
                        ) : (
                          <span className="text-zinc-600 dark:text-zinc-300">{String(pay ?? "")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Building now</h2>
          <div className="space-y-2">
            {[...coursesByOwner.entries()].map(([ownerId, courses]) => {
              const ownerName = DEMO_PEOPLE[ownerId]?.name ?? ownerId;
              return (
                <div key={ownerId} className="rounded-lg border border-black/[.08] p-3 dark:border-white/[.12]">
                  <div className="mb-2 text-sm font-medium text-black dark:text-zinc-50">{ownerName}</div>
                  {courses.map((c) => (
                    <div key={c.title} className="mb-1.5 flex items-center gap-3">
                      <span className="w-40 truncate text-xs text-zinc-500">{c.title}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-teal-600" style={{ width: `${c.pct}%` }} />
                      </div>
                      <span className="w-8 text-right text-xs text-zinc-400">{c.pct}%</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Capability gaps</h2>
          <div className="flex flex-wrap gap-2">
            {[...coursesByOwner.entries()].map(([ownerId, courses]) => (
              <span key={ownerId} className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-800">
                1-person · {courses[0]?.title}
              </span>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
