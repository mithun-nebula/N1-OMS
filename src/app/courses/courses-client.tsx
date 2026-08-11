"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Module {
  name: string;
  state: string;
}

interface Course {
  id: string;
  title: string;
  stage: string;
  stageLabel: string;
  owner?: string;
  ownerName: string;
  stageOwners: Record<string, string>;
  progressNote?: { text: string; at: string; by: string };
  completion: number;
  explainer?: string;
  stale: boolean;
  daysWaiting?: number;
  nextStages: string[];
  modules: Module[];
  versions: Array<{ version: number; at: string; by: string; reason?: string }>;
}

const STAGE_ORDER = ["outline", "draft", "review", "published"];
const STAGE_LABELS: Record<string, string> = { outline: "Outline", draft: "Draft", review: "Review", published: "Published" };
const MODULE_STATES = ["not-started", "draft", "review", "published"];

export function CoursesClient({
  courses,
  people,
  actorRole,
}: {
  courses: Course[];
  people: Array<{ id: string; name: string }>;
  actorRole: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const canEdit = actorRole !== "intern";

  async function run(name: string, args: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name, args }),
    });
    await res.json();
    setBusy(false);
    router.refresh();
  }

  const sel = courses.find((c) => c.id === selected);

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAGE_ORDER.map((stage) => {
          const inStage = courses.filter((c) => c.stage === stage);
          return (
            <div key={stage} className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{STAGE_LABELS[stage]}</span>
                <span className="text-xs text-zinc-400">{inStage.length}</span>
              </div>
              <div className="space-y-2">
                {inStage.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors hover:border-teal-700/40 ${
                      c.stale
                        ? "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950"
                        : "border-black/[.08] bg-white dark:border-white/[.12] dark:bg-black"
                    }`}
                  >
                    <div className="text-sm font-medium text-black dark:text-zinc-50">{c.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                      <span>{c.ownerName}</span>
                      <span>·</span>
                      <span>{c.completion}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-teal-600" style={{ width: `${c.completion}%` }} />
                    </div>
                    {c.stale && <div className="mt-2 text-xs font-medium text-rose-600">Waiting {c.daysWaiting} days</div>}
                  </button>
                ))}
                {inStage.length === 0 && <p className="px-1 py-4 text-center text-xs text-zinc-300">Empty</p>}
              </div>
            </div>
          );
        })}
      </div>

      {sel && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 dark:bg-black" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-black dark:text-zinc-50">{sel.title}</h2>
                <p className="text-xs text-zinc-400">{sel.ownerName} · {sel.stageLabel} · {sel.completion}% done</p>
                {sel.explainer && <p className="mt-1 text-xs text-zinc-500">{sel.explainer}</p>}
              </div>
              <button onClick={() => setSelected(null)} className="text-xs text-zinc-400">Close</button>
            </div>

            {canEdit && sel.nextStages.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="text-xs text-zinc-400">Move to:</span>
                {sel.nextStages.map((s) => (
                  <button key={s} onClick={() => run("course.updateStage", { courseId: sel.id, stage: s })} disabled={busy} className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
                    {STAGE_LABELS[s] ?? s}
                  </button>
                ))}
              </div>
            )}

            <section className="mb-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Modules</h3>
              <div className="space-y-1">
                {sel.modules.map((m, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-900">
                    <span className="text-zinc-600 dark:text-zinc-300">{m.name}</span>
                    {canEdit ? (
                      <select
                        value={m.state}
                        onChange={(e) => run("course.setModuleState", { courseId: sel.id, moduleIndex: i, state: e.target.value })}
                        disabled={busy}
                        className="rounded border border-black/[.08] bg-transparent text-xs dark:border-white/[.1] dark:text-zinc-50"
                      >
                        {MODULE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className="text-zinc-400">{m.state}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {canEdit && (
              <section className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Assign stage owner</h3>
                <div className="flex flex-wrap gap-2">
                  {STAGE_ORDER.map((s) => (
                    <select
                      key={s}
                      defaultValue={sel.stageOwners[s] ?? ""}
                      onChange={(e) => { if (e.target.value) run("course.assignStageOwner", { courseId: sel.id, stage: s, owner: e.target.value }); }}
                      className="rounded-lg border border-black/[.08] px-2 py-1 text-xs dark:border-white/[.1] dark:bg-black dark:text-zinc-50"
                    >
                      <option value="">{STAGE_LABELS[s]}: —</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Progress note</h3>
              {sel.progressNote ? (
                <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">“{sel.progressNote.text}” — {sel.progressNote.by}</p>
              ) : (
                <p className="text-xs text-zinc-400">None.</p>
              )}
              {canEdit && (
                <div className="mt-2 flex gap-2">
                  <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a progress note" className="flex-1 rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                  <button onClick={() => { if (noteDraft.trim()) { run("course.setProgressNote", { courseId: sel.id, note: noteDraft.trim() }); setNoteDraft(""); } }} disabled={busy || !noteDraft.trim()} className="rounded-lg bg-black px-2 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Add</button>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Version history ({sel.versions.length})</h3>
              <div className="space-y-1">
                {sel.versions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-900">
                    <span className="text-zinc-600 dark:text-zinc-300">v{v.version} · {v.by} · {v.reason ?? "—"}</span>
                    {canEdit && (
                      <button onClick={() => run("course.restoreVersion", { courseId: sel.id, version: v.version })} disabled={busy} className="text-teal-600 underline disabled:opacity-40">restore</button>
                    )}
                  </div>
                ))}
                {sel.versions.length === 0 && <p className="text-xs text-zinc-400">No versions yet.</p>}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
