import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getDayPlanService } from "@/server/runtime";
import { getNews } from "@/domains/assistant/news";
import { TodayClient } from "./today-client";
import { LogoutButton } from "./logout-button";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function TodayPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const date = today();
  const service = getDayPlanService();
  const start = service.startDay(user.id, date);
  const plan = start.plan ?? service.getStore().get(user.id, date) ?? null;
  const briefItem = plan ? service.currentBriefItem(plan) : null;
  const dashboard = plan?.phase === "planned" ? service.dashboard(user.id, date) : null;
  const news = getNews();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="border-b border-black/[.08] bg-white dark:border-white/[.1] dark:bg-black">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-teal-700 dark:text-teal-400">
              Organization A · Today
            </div>
            <div className="mt-0.5 text-lg font-semibold text-black dark:text-zinc-50">
              {user.displayName}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-teal-700/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-300">
              {user.role}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <TodayClient
        user={{ id: user.id, displayName: user.displayName, role: user.role }}
        date={date}
        initial={{ open: start.open, prompt: start.prompt, briefItem, dashboard, plan, news }}
      />
    </div>
  );
}
