"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Task {
  id: string;
  title: string;
  assignedTo?: string;
  status: string;
  priority: string;
  dueDate?: string;
  projectId?: string;
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
}: {
  tasks: Task[];
  people: Array<{ id: string; name: string }>;
  actor: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", assignedTo: "", priority: "medium", dueDate: "" });
  const [busy, setBusy] = useState(false);

  async function createTask() {
    if (!form.title) return;
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "task.create",
        args: {
          title: form.title,
          assignedTo: form.assignedTo || undefined,
          priority: form.priority,
          dueDate: form.dueDate || undefined,
        },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      setShowForm(false);
      setForm({ title: "", assignedTo: "", priority: "medium", dueDate: "" });
      router.refresh();
    }
  }

  async function completeTask(taskId: string) {
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "task.complete", args: { taskId } }),
    });
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: "done" } : t)));
  }

  async function assignTask(taskId: string, assignedTo: string) {
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "task.assign", args: { taskId, assignedTo } }),
    });
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, assignedTo } : t)));
  }

  const personName = (id?: string) => people.find((p) => p.id === id)?.name ?? "Unassigned";
  void personName;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-400">{tasks.length} tasks</p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white"
        >
          {showForm ? "Cancel" : "+ New task"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <div className="flex flex-wrap items-end gap-3">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Task title"
              className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
            />
            <select
              value={form.assignedTo}
              onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
              className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
            >
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
            />
            <button onClick={createTask} disabled={busy || !form.title} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">
              Create
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          return (
            <div key={col.id} className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{col.label}</span>
                <span className="text-xs text-zinc-400">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => (
                  <div key={t.id} className="rounded-lg border border-black/[.08] bg-white p-3 dark:border-white/[.12] dark:bg-black">
                    <div className="flex items-start justify-between">
                      <span className="text-sm font-medium text-black dark:text-zinc-50">{t.title}</span>
                      {t.status !== "done" && (
                        <button onClick={() => completeTask(t.id)} className="text-xs text-teal-600 underline">done</button>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                      <select
                        value={t.assignedTo ?? ""}
                        onChange={(e) => assignTask(t.id, e.target.value)}
                        className="rounded border border-black/[.08] bg-transparent text-xs dark:border-white/[.1]"
                      >
                        <option value="">Unassigned</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {t.dueDate && <span>{t.dueDate}</span>}
                      <span className={`rounded-full px-1.5 py-0.5 ${t.priority === "high" ? "bg-rose-100 text-rose-600" : t.priority === "medium" ? "bg-amber-100 text-amber-600" : "bg-zinc-100 text-zinc-400"}`}>
                        {t.priority}
                      </span>
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-zinc-300">Empty</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
