import type { DomainContext } from "../types";

export function seedTasks(ctx: DomainContext): void {
  const tasks: Array<{
    id: string;
    title: string;
    description?: string;
    assignedTo: string;
    status: string;
    priority: string;
    dueDate?: string;
    projectId?: string;
  }> = [
    { id: "task-1", title: "Review AI for Presentations", assignedTo: "meena", status: "in-progress", priority: "high", dueDate: "2026-08-10", projectId: "ai-presentations" },
    { id: "task-2", title: "Write Module 4 — Practice", assignedTo: "priya", status: "todo", priority: "medium", dueDate: "2026-08-15", projectId: "ai-presentations" },
    { id: "task-3", title: "Outline Spreadsheet Automation", assignedTo: "karthik", status: "todo", priority: "medium", projectId: "spreadsheet-automation" },
    { id: "task-4", title: "Update AI Basics 2nd ed.", assignedTo: "divya", status: "todo", priority: "low", dueDate: "2026-08-20" },
    { id: "task-5", title: "Onboard Ravi — IT setup", assignedTo: "shruti", status: "done", priority: "low" },
    { id: "task-6", title: "Prepare Friday showcase deck", assignedTo: "arun", status: "in-progress", priority: "high", dueDate: "2026-08-09" },
  ];
  for (const t of tasks) {
    ctx.graph.putNode("task", t.id, {
      title: t.title,
      description: t.description,
      assignedTo: t.assignedTo,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      projectId: t.projectId,
      createdBy: "james",
    });
    ctx.graph.addEdge({ from: t.assignedTo, to: t.id, type: "assigned" });
  }
}
