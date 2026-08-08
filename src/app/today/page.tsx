import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getDayPlanService } from "@/server/runtime";
import { getNews } from "@/domains/assistant/news";
import { TodayClient } from "./today-client";
import { Shell } from "../shell";

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
    <Shell>
      <TodayClient
        user={{ id: user.id, displayName: user.displayName, role: user.role }}
        date={date}
        initial={{ open: start.open, prompt: start.prompt, briefItem, dashboard, plan, news }}
      />
    </Shell>
  );
}
