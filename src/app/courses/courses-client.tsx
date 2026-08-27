"use client";

import { useState } from "react";
import { Avatar, AvatarStack, Bar, inputCls, Modal, OpFeedback, SectionTitle, StatusBadge } from "../ui/kit";
import { FigureValue } from "../ui/figure";
import { useOperation } from "@/components/ops/use-operation";

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
  assignees: string[];
  assigneeNames: string[];
}

interface PersonalCourse {
  courseId: string;
  title: string;
  stage: string;
  stageLabel: string;
  completion: number;
  taskId?: string;
  taskStatus?: string;
  worked: boolean;
}

const MAX_ASSIGNEES = 3;

/* Each pipeline stage owns a category color, like the task board's columns. */
const STAGE_ORDER = ["outline", "draft", "review", "published"];
const STAGE_LABELS: Record<string, string> = { outline: "Outline", draft: "Draft", review: "Review", published: "Published" };
const STAGE_STYLE: Record<string, { dot: string; count: string; bar: string }> = {
  outline: { dot: "bg-peach-strong", count: "bg-peach text-peach-strong", bar: "bg-peach-strong" },
  draft: { dot: "bg-lilac-strong", count: "bg-lilac text-lilac-strong", bar: "bg-lilac-strong" },
  review: { dot: "bg-rose-strong", count: "bg-rose text-rose-strong", bar: "bg-rose-strong" },
  published: { dot: "bg-mint-strong", count: "bg-mint text-mint-strong", bar: "bg-mint-strong" },
};
const MODULE_STATES = ["not-started", "draft", "review", "published"];

export function CoursesClient({
  courses,
  personal,
  people,
  actorRole,
  isManager,
  canDelete,
}: {
  courses: Course[];
  personal: PersonalCourse[];
  people: Array<{ id: string; name: string }>;
  actorRole: string;
  isManager: boolean;
  canDelete: boolean;
}) {
  const op = useOperation();
  const busy = op.busy;
  const [selected, setSelected] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", modules: "" });
  const [assignPick, setAssignPick] = useState<string[]>([]);

  const canEdit = actorRole !== "intern";
  const workingOn = personal.filter((p) => !p.worked);
  const worked = personal.filter((p) => p.worked);

  async function run(name: string, args: Record<string, unknown>) {
    await op.run(name, args);
  }

  async function createCourse() {
    if (!createForm.title.trim()) return;
    const modules = createForm.modules
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const outcome = await op.run("course.create", {
      title: createForm.title.trim(),
      modules: modules.length > 0 ? modules : undefined,
    });
    // Keep the form and its input when the gate refuses.
    if (outcome.status === "ran") {
      setShowCreate(false);
      setCreateForm({ title: "", modules: "" });
    }
  }

  function togglePick(id: string) {
    setAssignPick((picks) =>
      picks.includes(id)
        ? picks.filter((p) => p !== id)
        : picks.length < MAX_ASSIGNEES
          ? [...picks, id]
          : picks,
    );
  }

  async function assignCourse(courseId: string) {
    if (assignPick.length === 0) return;
    const outcome = await op.run("course.assign", { courseId, assignees: assignPick });
    if (outcome.status === "ran") setAssignPick([]);
  }

  const sel = courses.find((c) => c.id === selected);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {/* ============ Your courses — worked / working on ============ */}
      {(workingOn.length > 0 || worked.length > 0) && (
        <section className="rise mb-6" style={{ animationDelay: "40ms" }}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <SectionTitle>Working on ({workingOn.length})</SectionTitle>
              <div className="mt-2 space-y-2">
                {workingOn.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
                    Nothing in progress.
                  </p>
                ) : (
                  workingOn.map((p) => (
                    <button
                      key={p.courseId}
                      onClick={() => setSelected(p.courseId)}
                      className="lift press flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left shadow-card"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{p.title}</span>
                        <span className="text-[11px] text-ink-faint">{p.stageLabel} · {p.completion}%</span>
                      </span>
                      {p.taskStatus && <StatusBadge status={p.taskStatus} />}
                    </button>
                  ))
                )}
              </div>
            </div>
            <div>
              <SectionTitle>Worked ({worked.length})</SectionTitle>
              <div className="mt-2 space-y-2">
                {worked.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
                    Nothing finished yet.
                  </p>
                ) : (
                  worked.map((p) => (
                    <button
                      key={p.courseId}
                      onClick={() => setSelected(p.courseId)}
                      className="lift press flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left opacity-80 shadow-card"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{p.title}</span>
                        <span className="text-[11px] text-ink-faint">{p.stageLabel} · {p.completion}%</span>
                      </span>
                      <span className="rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-semibold text-mint-strong">Done</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ New course (manager+) ============ */}
      {isManager && (
        <div className="rise mb-4 flex justify-end" style={{ animationDelay: "60ms" }}>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="press rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card"
          >
            {showCreate ? "Cancel" : "+ New course"}
          </button>
        </div>
      )}
      {isManager && showCreate && (
        <div className="pop-in mb-5 rounded-3xl bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-end gap-2.5">
            <input
              value={createForm.title}
              onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
              placeholder="Course title"
              className={`${inputCls} min-w-40 flex-1 bg-raised py-2`}
            />
            <input
              value={createForm.modules}
              onChange={(e) => setCreateForm({ ...createForm, modules: e.target.value })}
              placeholder="Modules, comma-separated (optional)"
              className={`${inputCls} min-w-48 flex-1 bg-raised py-2`}
            />
            <button
              onClick={createCourse}
              disabled={busy || !createForm.title.trim()}
              className="press rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
            >
              Create course
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAGE_ORDER.map((stage, si) => {
          const s = STAGE_STYLE[stage];
          const inStage = courses.filter((c) => c.stage === stage);
          return (
            <div key={stage} className="rise" style={{ animationDelay: `${80 + si * 70}ms` }}>
              <div className="mb-2.5 flex items-center gap-2 px-1">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                <span className="text-sm font-bold text-ink">{STAGE_LABELS[stage]}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.count}`}>{inStage.length}</span>
              </div>
              <div className="space-y-2.5 rounded-3xl bg-raised/60 p-2.5">
                {inStage.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    style={{ animationDelay: `${140 + si * 70 + i * 45}ms` }}
                    className={`rise lift press w-full rounded-2xl bg-surface p-3.5 text-left shadow-card ${
                      c.stale ? "border-l-[3px] border-danger" : ""
                    }`}
                  >
                    <div className="text-[13px] font-semibold leading-snug text-ink">{c.title}</div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-faint">
                      <Avatar name={c.ownerName} size={18} />
                      <span className="truncate">{c.ownerName}</span>
                      {c.assigneeNames.length > 0 && (
                        <span title={`Working: ${c.assigneeNames.join(", ")}`}>
                          <AvatarStack names={c.assigneeNames} max={3} />
                        </span>
                      )}
                      <FigureValue
                        nodeType="course"
                        nodeId={c.id}
                        label="Course completion"
                        className="ml-auto font-semibold text-ink-soft"
                      >
                        {c.completion}%
                      </FigureValue>
                    </div>
                    <div className="mt-2 flex">
                      <Bar pct={c.completion} tone={s.bar} />
                    </div>
                    {c.stale && (
                      <div className="mt-2 text-[11px] font-semibold text-danger">
                        Waiting {c.daysWaiting} days
                      </div>
                    )}
                  </button>
                ))}
                {inStage.length === 0 && (
                  <p className="fade-in rounded-2xl px-2 py-8 text-center text-xs text-ink-faint">Nothing here yet.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sel && (
        <Modal onClose={() => setSelected(null)} wide>
          {/* Lets voice resolve "this course" / "that one" while the modal is open. */}
          <div data-record-type="course" data-record-id={sel.id}>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-ink">{sel.title}</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
                <Avatar name={sel.ownerName} size={18} /> {sel.ownerName} · {sel.stageLabel} ·{" "}
                <FigureValue nodeType="course" nodeId={sel.id} label="Course completion">
                  {sel.completion}% done
                </FigureValue>
              </p>
              {sel.explainer && <p className="mt-1 text-xs text-ink-faint">{sel.explainer}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {canDelete && (
                <button
                  onClick={async () => {
                    const outcome = await op.run("course.delete", { courseId: sel.id });
                    if (outcome.status === "ran") setSelected(null);
                  }}
                  disabled={busy}
                  className="press rounded-full bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-40"
                >
                  Delete
                </button>
              )}
              <button onClick={() => setSelected(null)} className="press text-xs font-medium text-ink-faint hover:text-ink">
                Close
              </button>
            </div>
          </div>

          {/* Who is working this course — assignment hands each person a task. */}
          {(isManager || sel.assigneeNames.length > 0) && (
            <section className="mb-5">
              <SectionTitle>Assigned to work it</SectionTitle>
              {sel.assigneeNames.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {sel.assigneeNames.map((n) => (
                    <span key={n} className="flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-ink">
                      <Avatar name={n} size={16} /> {n}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-faint">Nobody yet.</p>
              )}
              {isManager && (
                <div className="mt-3">
                  <p className="text-[11px] text-ink-faint">
                    Pick up to {MAX_ASSIGNEES} people — each gets their own “Work on {sel.title}” task.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePick(p.id)}
                        className={`press rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          assignPick.includes(p.id)
                            ? "bg-accent-strong text-white"
                            : "bg-raised text-ink-soft hover:text-ink"
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => assignCourse(sel.id)}
                    disabled={busy || assignPick.length === 0}
                    className="press mt-2.5 rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    Assign {assignPick.length > 0 ? `(${assignPick.length})` : ""}
                  </button>
                </div>
              )}
            </section>
          )}

          {canEdit && sel.nextStages.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Move to</span>
              {sel.nextStages.map((s) => (
                <button
                  key={s}
                  onClick={() => run("course.updateStage", { courseId: sel.id, stage: s })}
                  disabled={busy}
                  className="press rounded-full bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
                >
                  {STAGE_LABELS[s] ?? s} →
                </button>
              ))}
            </div>
          )}

          <section className="mb-5">
            <SectionTitle>Modules</SectionTitle>
            <div className="mt-2 space-y-1.5">
              {sel.modules.map((m, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-xs">
                  <span className="font-medium text-ink">{m.name}</span>
                  {canEdit ? (
                    <select
                      value={m.state}
                      onChange={(e) => run("course.setModuleState", { courseId: sel.id, moduleIndex: i, state: e.target.value })}
                      disabled={busy}
                      className={inputCls}
                    >
                      {MODULE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <span className="text-ink-faint">{m.state}</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {canEdit && (
            <section className="mb-5">
              <SectionTitle>Assign stage owner</SectionTitle>
              <div className="mt-2 flex flex-wrap gap-2">
                {STAGE_ORDER.map((s) => (
                  <select
                    key={s}
                    defaultValue={sel.stageOwners[s] ?? ""}
                    onChange={(e) => { if (e.target.value) run("course.assignStageOwner", { courseId: sel.id, stage: s, owner: e.target.value }); }}
                    className={inputCls}
                  >
                    <option value="">{STAGE_LABELS[s]}: —</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ))}
              </div>
            </section>
          )}

          <section className="mb-5">
            <SectionTitle>Progress note</SectionTitle>
            {sel.progressNote ? (
              <p className="mt-2 rounded-xl border-l-[3px] border-accent-strong bg-accent-soft px-3 py-2 text-xs text-ink">
                “{sel.progressNote.text}” — <span className="font-semibold">{sel.progressNote.by}</span>
              </p>
            ) : (
              <p className="mt-2 text-xs text-ink-faint">None.</p>
            )}
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add a progress note"
                  className={`${inputCls} flex-1`}
                />
                <button
                  onClick={() => { if (noteDraft.trim()) { run("course.setProgressNote", { courseId: sel.id, note: noteDraft.trim() }); setNoteDraft(""); } }}
                  disabled={busy || !noteDraft.trim()}
                  className="press rounded-xl bg-chrome px-3 py-1.5 text-xs font-semibold text-chrome-ink disabled:opacity-40"
                >
                  Add note
                </button>
              </div>
            )}
          </section>

          <section>
            <SectionTitle>Version history ({sel.versions.length})</SectionTitle>
            <div className="mt-2 space-y-1.5">
              {sel.versions.map((v) => (
                <div key={v.version} className="flex items-center justify-between rounded-xl bg-raised px-3 py-2 text-xs">
                  <span className="text-ink-soft">
                    <span className="font-bold text-ink">v{v.version}</span> · {v.by} · {v.reason ?? "—"}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => run("course.restoreVersion", { courseId: sel.id, version: v.version })}
                      disabled={busy}
                      className="press font-semibold text-accent-strong hover:underline disabled:opacity-40"
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))}
              {sel.versions.length === 0 && <p className="text-xs text-ink-faint">No versions yet.</p>}
            </div>
          </section>
          </div>
        </Modal>
      )}
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
