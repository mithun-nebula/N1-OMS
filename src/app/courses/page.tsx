import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getCourseService, getSpine, getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
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
    const data = node?.data as { modules?: Array<{ name: string; state: string }> };
    const versions = (await readVersions(deps.graph, c.id)).map((v) => ({
      version: v.version,
      at: v.at,
      by: DEMO_PEOPLE[v.by]?.name ?? v.by,
      reason: v.reason,
    }));
    enriched.push({
      id: c.id,
      title: c.title,
      stage: c.stage,
      stageLabel: STAGE_LABELS[c.stage] ?? c.stage,
      owner: c.owner,
      ownerName: DEMO_PEOPLE[c.owner ?? ""]?.name ?? c.owner ?? "—",
      stageOwners: c.stageOwners ?? {},
      progressNote: c.progressNote,
      completion: c.completion?.value ?? 0,
      explainer: c.completion?.explainer,
      stale: c.stale,
      daysWaiting: c.daysWaiting,
      nextStages: nextStages(c.stage),
      modules: data.modules ?? [],
      versions,
    });
  }

  const people = Object.entries(DEMO_PEOPLE).map(([id, p]) => ({ id, name: p.name }));

  return (
    <Shell>
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <div>
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Course pipeline</h1>
          <p className="text-sm text-zinc-400">Move stages · edit modules · version history</p>
        </div>
        <ExportButton type="course" canExport={spine.canExport(user.id, "course")} />
      </header>
      <CoursesClient courses={enriched} people={people} actorRole={user.role} />
    </Shell>
  );
}
