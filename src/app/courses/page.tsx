import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getCourseService, getSpine, getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isManagerOrAbove, isAdminLike } from "@/server/roles";
import { nextStages } from "@/domains/course/stages";
import { readVersions } from "@/domains/course/versioning";
import { Shell } from "../shell";
import { ExportButton } from "../chrome/export-button";
import { CoursesClient } from "./courses-client";

const STAGE_LABELS: Record<string, string> = {
  outline: "Outline",
  draft: "Draft",
  review: "Review",
  published: "Published",
};

export default async function CoursesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = await getSpine();
  const { deps } = await getWorld();
  const asOf = new Date().toISOString();

  const all = await (await getCourseService()).listProgress(asOf);
  const courses: typeof all = [];
  for (const c of all) {
    const r = await spine.read({ actor: user.id, nodeType: "course", nodeId: c.id });
    if (r.found) courses.push(c);
  }

  const enriched = [];
  for (const c of courses) {
    const node = await deps.graph.getNode("course", c.id);
    const data = node?.data as {
      modules?: Array<{ name: string; state: string }>;
      assignees?: string[];
    };
    const versions = (await readVersions(deps.graph, c.id)).map((v) => ({
      version: v.version,
      at: v.at,
      by: directory().nameOf(v.by),
      reason: v.reason,
    }));
    const assignees = data.assignees ?? [];
    enriched.push({
      id: c.id,
      title: c.title,
      stage: c.stage,
      stageLabel: STAGE_LABELS[c.stage] ?? c.stage,
      owner: c.owner,
      ownerName: c.owner ? directory().nameOf(c.owner) : "—",
      stageOwners: c.stageOwners ?? {},
      progressNote: c.progressNote,
      completion: c.completion?.value ?? 0,
      explainer: c.completion?.explainer,
      stale: c.stale,
      daysWaiting: c.daysWaiting,
      nextStages: nextStages(c.stage),
      modules: data.modules ?? [],
      versions,
      assignees,
      assigneeNames: assignees.map((a) => directory().nameOf(a)),
    });
  }

  // The personal half: what THIS person is working on / has worked. Driven by
  // their own course-linked tasks (one per assignment) plus courses they own
  // or are listed on. "Worked" = their task is done, or the course shipped.
  const myTasks = await deps.graph.find("task", (n) => {
    const d = n.data as { assignedTo?: string; courseId?: string };
    return d.assignedTo === user.id && Boolean(d.courseId);
  });
  const myTaskByCourse = new Map(
    myTasks.map((t) => {
      const d = t.data as { courseId?: string; status?: string };
      return [String(d.courseId), { taskId: t.id, status: String(d.status ?? "todo") }];
    }),
  );
  const personal = enriched
    .filter(
      (c) =>
        myTaskByCourse.has(c.id) || c.assignees.includes(user.id) || c.owner === user.id,
    )
    .map((c) => {
      const task = myTaskByCourse.get(c.id);
      const worked = task ? task.status === "done" : c.stage === "published";
      return {
        courseId: c.id,
        title: c.title,
        stage: c.stage,
        stageLabel: c.stageLabel,
        completion: c.completion,
        taskId: task?.taskId,
        taskStatus: task?.status,
        worked,
      };
    });

  const people = directory().all().filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  return (
    <Shell>
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
            <span className="font-extrabold">Courses</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Your work first · the pipeline below{isManagerOrAbove(user.role) ? " · create, assign, move stages" : ""}
          </p>
        </div>
        <ExportButton type="course" canExport={spine.canExport(user.id, "course")} />
      </header>
      <CoursesClient
        courses={enriched}
        personal={personal}
        people={people}
        actorRole={user.role}
        isManager={isManagerOrAbove(user.role)}
        canDelete={isAdminLike(user.role)}
      />
    </Shell>
  );
}
