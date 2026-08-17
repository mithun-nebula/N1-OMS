"use client";

import { useState } from "react";
import { isAdminLike } from "@/server/roles";
import { Icon } from "../ui/icons";
import { inputCls, OpFeedback, PriorityBadge } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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

/* Each column owns a category color, T1-style. */
const COLUMNS = [
  { id: "todo", label: "To Do", dot: "bg-peach-strong", count: "bg-peach text-peach-strong", bar: "bg-peach-strong" },
  { id: "in-progress", label: "In Progress", dot: "bg-lilac-strong", count: "bg-lilac text-lilac-strong", bar: "bg-lilac-strong" },
  { id: "done", label: "Done", dot: "bg-mint-strong", count: "bg-mint text-mint-strong", bar: "bg-mint-strong" },
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
  const [tasks] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", assignedTo: "", priority: "medium", dueDate: "" });
  const op = useOperation();
  const busy = op.busy;
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", priority: "medium", dueDate: "" });
  const [filters, setFilters] = useState({ assignee: "", project: "", priority: "" });

  const canDelete = isAdminLike(actorRole);
  const today = new Date().toISOString().slice(0, 10);

  async function runLeaving(taskId: string, name: string, args: Record<string, unknown>) {
    setLeaving((s) => new Set(s).add(taskId)); // collapse while the operation runs
    const outcome = await op.run(name, args);
    if (outcome.status !== "ran") {
      // Refused or parked: bring the row back — it did not actually complete.
      setLeaving((s) => {
        const next = new Set(s);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function createTask() {
    if (!form.title) return;
    const outcome = await op.run("task.create", {
      title: form.title,
      assignedTo: form.assignedTo || undefined,
      priority: form.priority,
      dueDate: form.dueDate || undefined,
    });
    // Keep the form (and its input) when the gate refuses or parks it.
    if (outcome.status === "ran") {
      setShowForm(false);
      setForm({ title: "", assignedTo: "", priority: "medium", dueDate: "" });
    }
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
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {/* ============ Filters + new task ============ */}
      <div className="rise mb-4 flex flex-wrap items-center gap-2" style={{ animationDelay: "60ms" }}>
        <select value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })} className={inputCls}>
          <option value="">All assignees</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.project} onChange={(e) => setFilters({ ...filters, project: e.target.value })} className={inputCls}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} className={inputCls}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <p className="ml-auto text-xs font-medium text-ink-faint">{filtered.length} tasks</p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="press rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card"
        >
          {showForm ? "Cancel" : "+ New task"}
        </button>
      </div>

      {/* ============ Create form ============ */}
      {showForm && (
        <div className="pop-in mb-5 rounded-3xl bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-end gap-2.5">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Task title" className={`${inputCls} min-w-40 flex-1 bg-raised py-2`} />
            <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className={`${inputCls} bg-raised py-2`}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={`${inputCls} bg-raised py-2`}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={`${inputCls} bg-raised py-2`} />
            <button
              onClick={createTask}
              disabled={busy || !form.title}
              className="press rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
            >
              Create task
            </button>
          </div>
        </div>
      )}

      {/* ============ Board ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {COLUMNS.map((col, ci) => {
          const colTasks = filtered.filter((t) => t.status === col.id);
          return (
            <div key={col.id} className="rise" style={{ animationDelay: `${120 + ci * 80}ms` }}>
              <div className="mb-2.5 flex items-center gap-2 px-1">
                <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                <span className="text-sm font-bold text-ink">{col.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${col.count}`}>
                  {colTasks.length}
                </span>
              </div>
              <div className="space-y-2.5 rounded-3xl bg-raised/60 p-2.5">
                {colTasks.map((t, i) => {
                  const overdue = t.status !== "done" && t.dueDate && t.dueDate < today;
                  return (
                    <div key={t.id} className="row-collapse" data-leaving={leaving.has(t.id)}>
                      <div>
                        <div
                          className="rise lift group rounded-2xl bg-surface p-3.5 shadow-card"
                          style={{ animationDelay: `${180 + ci * 80 + i * 45}ms` }}
                        >
                          {editingId === t.id ? (
                            <div className="pop-in space-y-2">
                              <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={`${inputCls} w-full bg-raised`} />
                              <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Description" className={`${inputCls} w-full bg-raised`} />
                              <div className="flex gap-2">
                                <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })} className={`${inputCls} bg-raised`}>
                                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} className={`${inputCls} bg-raised`} />
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => { op.run("task.edit", { taskId: t.id, title: editForm.title, description: editForm.description || undefined, priority: editForm.priority, dueDate: editForm.dueDate || undefined }); setEditingId(null); }}
                                  disabled={busy}
                                  className="press rounded-lg bg-chrome px-3 py-1.5 text-xs font-semibold text-chrome-ink disabled:opacity-40"
                                >
                                  Save changes
                                </button>
                                <button onClick={() => setEditingId(null)} className="text-xs font-medium text-ink-faint hover:text-ink">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[13px] font-semibold leading-snug text-ink">{t.title}</span>
                                {/* Actions reveal on hover; always visible on touch (no hover state). */}
                                <div className="flex shrink-0 gap-1 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
                                  {t.status !== "done" && (
                                    <IconAction title="Mark done" onClick={() => runLeaving(t.id, "task.complete", { taskId: t.id })} disabled={busy} tone="hover:bg-mint hover:text-mint-strong">
                                      <Icon name="check" className="h-3.5 w-3.5" />
                                    </IconAction>
                                  )}
                                  <IconAction title="Edit" onClick={() => startEdit(t)} disabled={busy} tone="hover:bg-accent-soft hover:text-accent-strong">
                                    <span className="text-[11px] font-bold leading-none">✎</span>
                                  </IconAction>
                                  {canDelete && (
                                    <IconAction title="Delete" onClick={() => runLeaving(t.id, "task.delete", { taskId: t.id })} disabled={busy} tone="hover:bg-danger-soft hover:text-danger">
                                      <span className="text-[13px] leading-none">×</span>
                                    </IconAction>
                                  )}
                                </div>
                              </div>
                              {t.description && (
                                <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{t.description}</p>
                              )}
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                                <select
                                  value={t.assignedTo ?? ""}
                                  onChange={(e) => op.run("task.assign", { taskId: t.id, assignedTo: e.target.value })}
                                  disabled={busy}
                                  className="rounded-lg border border-line bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-ink-soft outline-none focus:border-accent-strong"
                                >
                                  <option value="">Unassigned</option>
                                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                                {t.dueDate && (
                                  <span className={`flex items-center gap-1 ${overdue ? "font-semibold text-danger" : "text-ink-faint"}`}>
                                    <Icon name="clock" className="h-3 w-3" />
                                    {t.dueDate}
                                    {overdue ? " · overdue" : ""}
                                  </span>
                                )}
                                <PriorityBadge priority={t.priority} />
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {colTasks.length === 0 && (
                  <p className="fade-in rounded-2xl px-2 py-8 text-center text-xs text-ink-faint">
                    Nothing here yet.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={() => op.confirm()}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </div>
  );
}

function IconAction({
  title,
  onClick,
  disabled,
  tone,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`press grid h-6 w-6 place-items-center rounded-lg text-ink-faint transition-colors disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  );
}

