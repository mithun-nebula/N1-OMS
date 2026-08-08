import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getCourseService, getSpine } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";

const STAGES = ["outline", "draft", "review", "published"] as const;
const STAGE_LABELS: Record<string, string> = {
  outline: "Outline",
  draft: "Draft",
  review: "Review",
  published: "Published",
};

export default async function CoursesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = getSpine();
  const all = getCourseService().listProgress("2026-08-08T23:59:59Z");
  const courses = all.filter((c) =>
    spine.read({ actor: user.id, nodeType: "course", nodeId: c.id }).found,
  );

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Course pipeline</h1>
      </header>
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage) => {
          const inStage = courses.filter((c) => c.stage === stage);
          return (
            <div key={stage} className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  {STAGE_LABELS[stage]}
                </span>
                <span className="text-xs text-zinc-400">{inStage.length}</span>
              </div>
              <div className="space-y-2">
                {inStage.map((c) => {
                  const owner = DEMO_PEOPLE[c.owner ?? ""]?.name ?? c.owner ?? "—";
                  return (
                    <div
                      key={c.id}
                      className={`rounded-lg border p-3 ${
                        c.stale
                          ? "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950"
                          : "border-black/[.08] bg-white dark:border-white/[.12] dark:bg-black"
                      }`}
                    >
                      <div className="text-sm font-medium text-black dark:text-zinc-50">{c.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                        <span>{owner}</span>
                        <span>·</span>
                        <span>{c.completion?.value ?? "?"}%</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-teal-600"
                          style={{ width: `${c.completion?.value ?? 0}%` }}
                        />
                      </div>
                      {c.stale && (
                        <div className="mt-2 text-xs font-medium text-rose-600">
                          Waiting {c.daysWaiting} days
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
