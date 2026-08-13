"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAdminLike } from "@/server/roles";

interface Task {
  id: string;
  title: string;
  assignedTo?: string;
  status: string;
  priority: string;
  dueDate?: string;
  projectId?: string;
  description?: string;
}

const COLUMNS = [
  { id: "todo", label: "To Do" },
  { id: "in-progress", label: "In Progress" },
  { id: "done", label: "Done" },
];

const PRIORITIES = ["low", "medium", "high"];

export function TasksClient({
  tasks: initial,
  people,
  actorRole,
}: {
  tasks: Task[];
  people: Array<{ id: string; name: string }>;
  actorRole: string;
}) {
  const router = useRouter();
  const [tasks] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", assignedTo: "", priority: "medium", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", priority: "medium", dueDate: "" });
  const [filters, setFilters] = useState({ assignee: "", project: "", priority: "" });

  const canDelete = isAdminLike(actorRole);
  const today = new Date().toISOString().slice(0, 10);

  async function run(name: string, args: Record<string, unknown>) {
    setBusy(true);
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name, args }),
    });
    setBusy(false);
    router.refresh();
  }

  async function createTask() {
    if (!form.title) return;
    await run("task.create", {
      title: form.title,
      assignedTo: form.assignedTo || undefined,
      priority: form.priority,
      dueDate: form.dueDate || undefined,
    });
    setShowForm(false);
    setForm({ title: "", assignedTo: "", priority: "medium", dueDate: "" });
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setEditForm({ title: t.title, description: t.description ?? "", priority: t.priority, dueDate: t.dueDate ?? "" });
  }

  const filtered = tasks.filter((t) => {
    if (filters.assignee && t.assignedTo !== filters.assignee) return false;
    if (filters.project && t.projectId !== filters.project) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    return true;
  });

  const projects = [...new Set(tasks.map((t) => t.projectId).filter(Boolean))] as string[];

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })} className="rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
          <option value="">All assignees</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.project} onChange={(e) => setFilters({ ...filters, project: e.target.value })} className="rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} className="rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <p className="ml-auto text-sm text-zinc-400">{filtered.length} tasks</p>
        <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
          {showForm ? "Cancel" : "+ New task"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <div className="flex flex-wrap items-end gap-3">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Task title" className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <button onClick={createTask} disabled={busy || !form.title} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Create</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {COLUMNS.map((col) => {
          const colTasks = filtered.filter((t) => t.status === col.id);
          return (
            <div key={col.id} className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{col.label}</span>
                <span className="text-xs text-zinc-400">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => {
                  const overdue = t.status !== "done" && t.dueDate && t.dueDate < today;
                  return (
                    <div key={t.id} className="rounded-lg border border-black/[.08] bg-white p-3 dark:border-white/[.12] dark:bg-black">
                      {editingId === t.id ? (
                        <div className="space-y-2">
                          <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="w-full rounded border border-black/[.12] px-2 py-1 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                          <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Description" className="w-full rounded border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                          <div className="flex gap-2">
                            <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })} className="rounded border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
                              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} className="rounded border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { run("task.edit", { taskId: t.id, title: editForm.title, description: editForm.description || undefined, priority: editForm.priority, dueDate: editForm.dueDate || undefined }); setEditingId(null); }} disabled={busy} className="rounded bg-teal-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-xs text-zinc-500">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between">
                            <span className="text-sm font-medium text-black dark:text-zinc-50">{t.title}</span>
                            <div className="flex gap-2">
                              {t.status !== "done" && <button onClick={() => run("task.complete", { taskId: t.id })} disabled={busy} className="text-xs text-teal-600 underline">done</button>}
                              <button onClick={() => startEdit(t)} className="text-xs text-zinc-400 hover:text-teal-600">edit</button>
                              {canDelete && <button onClick={() => run("task.delete", { taskId: t.id })} disabled={busy} className="text-xs text-zinc-400 hover:text-rose-600">del</button>}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                            <select value={t.assignedTo ?? ""} onChange={(e) => run("task.assign", { taskId: t.id, assignedTo: e.target.value })} disabled={busy} className="rounded border border-black/[.08] bg-transparent text-xs dark:border-white/[.1]">
                              <option value="">Unassigned</option>
                              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            {t.dueDate && <span className={overdue ? "font-medium text-rose-600" : ""}>{t.dueDate}{overdue ? " · overdue" : ""}</span>}
                            <span className={`rounded-full px-1.5 py-0.5 ${t.priority === "high" ? "bg-rose-100 text-rose-600" : t.priority === "medium" ? "bg-amber-100 text-amber-600" : "bg-zinc-100 text-zinc-400"}`}>{t.priority}</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
                {colTasks.length === 0 && <p className="px-1 py-4 text-center text-xs text-zinc-300">Empty</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
