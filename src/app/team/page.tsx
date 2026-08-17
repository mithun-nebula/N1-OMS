import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isRestricted } from "@/spine/permission/types";
import { Shell } from "../shell";
import { ExportButton } from "../chrome/export-button";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = await getSpine();
  const { deps } = await getWorld();

  // One query rather than a database round trip per person, and it returns
  // only the people this actor may see, already field-filtered.
  const visiblePeople = await spine.readMany({
    actor: user.id,
    nodeType: "employee",
    filter: (data) => data.status !== "inactive" && data.status !== "separated",
  });

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

  const rows = visiblePeople.map(({ nodeId: id, record }) => ({
    id,
    name: String(record.name ?? ""),
    role: String(record.role ?? ""),
    contact: isRestricted(record.contact) ? undefined : String(record.contact ?? ""),
    payRestricted: isRestricted(record.pay),
  }));

  // Tasks and leave go through the spine, so the viewer's scope decides what
  // the profile modal shows: your own leave, your team's if you manage it,
  // everyone's if you are HR. This used to read the graph directly and hand
  // every employee the whole organisation's leave dates.
  const visibleTasks = await spine.readMany({
    actor: user.id,
    nodeType: "task",
    filter: (d) => d.status !== "done",
  });
  const visibleLeave = await spine.readMany({ actor: user.id, nodeType: "leave" });

  const tasksByAssignee = new Map<string, Array<{ title: string; priority: string; dueDate?: string }>>();
  for (const { record } of visibleTasks) {
    const d = record as Record<string, unknown>;
    const assignee = String(d.assignedTo ?? "");
    if (!assignee) continue;
    const list = tasksByAssignee.get(assignee) ?? [];
    list.push({ title: String(d.title ?? ""), priority: String(d.priority ?? "medium"), dueDate: d.dueDate ? String(d.dueDate) : undefined });
    tasksByAssignee.set(assignee, list);
  }
  const leaveByEmployee = new Map<string, Array<{ fromDate: string; toDate: string; status: string }>>();
  for (const { record } of visibleLeave) {
    const d = record as Record<string, unknown>;
    const employeeId = String(d.employeeId ?? d.employee ?? "");
    if (!employeeId) continue;
    const list = leaveByEmployee.get(employeeId) ?? [];
    list.push({ fromDate: String(d.fromDate ?? ""), toDate: String(d.toDate ?? ""), status: String(d.status ?? "") });
    leaveByEmployee.set(employeeId, list);
  }

  const perPerson: Array<{ id: string; courses: Array<{ title: string; pct: number }>; tasks: Array<{ title: string; priority: string; dueDate?: string }>; leave: Array<{ fromDate: string; toDate: string; status: string }> }> = [];
  for (const id of directory().activeIds()) {
    const courses = (coursesByOwner.get(id) ?? []).map((c) => ({ title: c.title, pct: c.pct }));
    const tasks = tasksByAssignee.get(id) ?? [];
    const leave = (leaveByEmployee.get(id) ?? []).sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
    perPerson.push({ id, courses, tasks, leave });
  }

  return (
    <Shell>
      <header className="rise flex items-center justify-between px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          The <span className="font-extrabold">team</span>
        </h1>
        <ExportButton type="employee" canExport={spine.canExport(user.id, "employee")} />
      </header>
      <TeamClient
        rows={rows}
        perPerson={perPerson}
        coursesByOwner={[...coursesByOwner.entries()].map(([ownerId, courses]) => ({
          ownerId,
          ownerName: directory().nameOf(ownerId),
          courses,
        }))}
      />
    </Shell>
  );
}
