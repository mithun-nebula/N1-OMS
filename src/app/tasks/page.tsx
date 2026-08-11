import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { getSpine } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";
import { ExportButton } from "../chrome/export-button";
import { TasksClient } from "./tasks-client";

export default async function TasksPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();
  const spine = await getSpine();

  const tasks = (await deps.graph.find("task", () => true)).map((n) => {
    const d = n.data as Record<string, unknown>;
    return {
      id: n.id,
      title: String(d.title ?? n.id),
      assignedTo: d.assignedTo ? String(d.assignedTo) : undefined,
      status: String(d.status ?? "todo"),
      priority: String(d.priority ?? "medium"),
      dueDate: d.dueDate ? String(d.dueDate) : undefined,
      projectId: d.projectId ? String(d.projectId) : undefined,
      description: d.description ? String(d.description) : undefined,
    };
  });

  const people = Object.entries(DEMO_PEOPLE).map(([id, p]) => ({ id, name: p.name }));

  return (
    <Shell>
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Tasks</h1>
        <ExportButton type="task" canExport={spine.canExport(user.id, "task")} />
      </header>
      <TasksClient tasks={tasks} people={people} actorRole={user.role} />
    </Shell>
  );
}
