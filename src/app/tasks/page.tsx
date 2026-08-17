import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { getSpine } from "@/server/runtime";
import { directory } from "@/server/directory";
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

  const people = directory().all().filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  return (
    <Shell>
      <header className="rise flex items-center justify-between px-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
            Task <span className="font-extrabold">board</span>
          </h1>
        </div>
        <ExportButton type="task" canExport={spine.canExport(user.id, "task")} />
      </header>
      <TasksClient tasks={tasks} people={people} actorRole={user.role} />
    </Shell>
  );
}
