import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { findOverdueSteps } from "@/domains/people/joining";
import { Shell } from "../shell";
import { HrClient } from "./hr-client";

export default async function HrPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!["super-admin", "admin", "hr"].includes(user.role)) redirect("/dashboard");

  const { deps } = await getWorld();
  const asOf = new Date().toISOString().slice(0, 10);

  const onboardings = (await deps.graph.find("onboarding", () => true)).map((n) => {
    const d = n.data as Record<string, unknown>;
    return {
      id: n.id,
      employeeId: String(d.employeeId ?? ""),
      employeeName: DEMO_PEOPLE[String(d.employeeId ?? "")]?.name ?? String(d.employeeId ?? ""),
      status: String(d.status ?? "active"),
      steps: Array.isArray(d.steps)
        ? (d.steps as Array<Record<string, unknown>>).map((s) => ({
            id: String(s.id ?? ""),
            title: String(s.title ?? ""),
            owner: String(s.owner ?? ""),
            ownerName: DEMO_PEOPLE[String(s.owner ?? "")]?.name ?? String(s.owner ?? ""),
            dueAt: String(s.dueAt ?? ""),
            status: String(s.status ?? "pending"),
          }))
        : [],
    };
  });

  const offboardings = (await deps.graph.find("offboarding", () => true)).map((n) => {
    const d = n.data as Record<string, unknown>;
    return {
      id: n.id,
      employeeId: String(d.employeeId ?? ""),
      employeeName: DEMO_PEOPLE[String(d.employeeId ?? "")]?.name ?? String(d.employeeId ?? ""),
      separationDate: String(d.separationDate ?? ""),
      status: String(d.status ?? "active"),
      separated: Boolean(d.separated),
      handovers: Array.isArray(d.handovers)
        ? (d.handovers as Array<Record<string, unknown>>).map((h) => ({
            id: String(h.id ?? ""),
            type: String(h.type ?? ""),
            title: String(h.title ?? ""),
            from: String(h.from ?? ""),
            to: String(h.to ?? ""),
            toName: DEMO_PEOPLE[String(h.to ?? "")]?.name ?? String(h.to ?? ""),
            status: String(h.status ?? "pending"),
          }))
        : [],
    };
  });

  const overdue = (await findOverdueSteps(deps.graph, asOf)).map((o) => ({
    employeeId: o.employeeId,
    employeeName: DEMO_PEOPLE[o.employeeId]?.name ?? o.employeeId,
    title: o.step.title,
    owner: o.step.owner,
  }));

  const people = Object.entries(DEMO_PEOPLE).map(([id, p]) => ({ id, name: p.name }));

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">HR — Joining & leaving</h1>
        <p className="text-sm text-zinc-400">Onboarding · offboarding · step-owner model</p>
      </header>
      <HrClient onboardings={onboardings} offboardings={offboardings} overdue={overdue} people={people} />
    </Shell>
  );
}
