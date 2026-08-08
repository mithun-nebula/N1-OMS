import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";
import { TasksClient } from "./tasks-client";

export default async function TasksPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = getWorld();

  const tasks = deps.graph.find("task", () => true).map((n) => ({
    id: n.id,
    title: (n.data as { title?: string }).title ?? n.id,
    assignedTo: (n.data as { assignedTo?: string }).assignedTo,
    status: (n.data as { status?: string }).status ?? "todo",
    priority: (n.data as { priority?: string }).priority ?? "medium",
    dueDate: (n.data as { dueDate?: string }).dueDate,
    projectId: (n.data as { projectId?: string }).projectId,
  }));

  const people = Object.entries(DEMO_PEOPLE).map(([id, p]) => ({ id, name: p.name }));

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Tasks</h1>
      </header>
      <TasksClient tasks={tasks} people={people} actor={user.id} />
    </Shell>
  );
}
