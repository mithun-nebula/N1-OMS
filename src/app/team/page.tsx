import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { isRestricted } from "@/spine/permission/types";
import { Shell } from "../shell";
import { ExportButton } from "../chrome/export-button";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = await getSpine();
  const { deps } = await getWorld();

  const visiblePeople: Array<{ id: string; person: typeof DEMO_PEOPLE[string]; record: Record<string, unknown> }> = [];
  for (const [id, person] of Object.entries(DEMO_PEOPLE)) {
    const read = await spine.read({ actor: user.id, nodeType: "employee", nodeId: id });
    if (read.found) visiblePeople.push({ id, person, record: read.record });
  }

  const coursesByOwner = new Map<string, Array<{ title: string; pct: number }>>();
  const allCourses = await deps.graph.find("course", () => true);
  for (const course of allCourses) {
    const owner = (course.data as { owner?: string }).owner;
    if (!owner) continue;
    const figs = (await deps.graph.getNode("course", course.id))
      ? await deps.figures.forRecord("course", course.id, "Course completion")
      : [];
    const pct = figs.length > 0 ? Number(figs[figs.length - 1].value) : 0;
    const list = coursesByOwner.get(owner) ?? [];
    list.push({ title: (course.data as { title?: string }).title ?? course.id, pct });
    coursesByOwner.set(owner, list);
  }

  const rows = visiblePeople.map(({ id, record }) => ({
    id,
    name: String(record.name ?? ""),
    role: String(record.role ?? ""),
    contact: isRestricted(record.contact) ? undefined : String(record.contact ?? ""),
    payRestricted: isRestricted(record.pay),
  }));

  const perPerson: Array<{ id: string; courses: Array<{ title: string; pct: number }>; tasks: Array<{ title: string; priority: string; dueDate?: string }>; leave: Array<{ fromDate: string; toDate: string; status: string }> }> = [];
  for (const id of Object.keys(DEMO_PEOPLE)) {
    const courses = (coursesByOwner.get(id) ?? []).map((c) => ({ title: c.title, pct: c.pct }));
    const tasks = (await deps.graph
      .find("task", (n) => {
        const d = n.data as { assignedTo?: string; status?: string };
        return d.assignedTo === id && d.status !== "done";
      }))
      .map((n) => {
        const d = n.data as Record<string, unknown>;
        return { title: String(d.title ?? ""), priority: String(d.priority ?? "medium"), dueDate: d.dueDate ? String(d.dueDate) : undefined };
      });
    const leave = (await deps.graph
      .find("leave", (n) => (n.data as { employeeId?: string }).employeeId === id))
      .map((n) => {
        const d = n.data as Record<string, unknown>;
        return { fromDate: String(d.fromDate ?? ""), toDate: String(d.toDate ?? ""), status: String(d.status ?? "") };
      })
      .sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
    perPerson.push({ id, courses, tasks, leave });
  }

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Team</h1>
          <ExportButton type="employee" canExport={spine.canExport(user.id, "employee")} />
        </div>
      </header>
      <TeamClient
        rows={rows}
        perPerson={perPerson}
        coursesByOwner={[...coursesByOwner.entries()].map(([ownerId, courses]) => ({
          ownerId,
          ownerName: DEMO_PEOPLE[ownerId]?.name ?? ownerId,
          courses,
        }))}
      />
    </Shell>
  );
}
