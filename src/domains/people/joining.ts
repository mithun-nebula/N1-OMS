import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { NodeId } from "@/spine/operation/types";
import type { RecordStore, RecordNode } from "@/spine/record/types";
import { teamLeadOf } from "./leave";

export interface OnboardingStep {
  id: string;
  title: string;
  owner: string;
  dueAt: string;
  status: "pending" | "done";
  completedAt?: string;
  completedBy?: string;
}

interface OnboardingData {
  employeeId: string;
  startedAt: string;
  status: "active" | "complete";
  steps: OnboardingStep[];
  [key: string]: unknown;
}

export function onboardingIdFor(employeeId: string): NodeId {
  return `onboarding:${employeeId}`;
}

async function readOnboarding(
  graph: RecordStore,
  employeeId: string,
): Promise<OnboardingData | undefined> {
  const node = await graph.getNode("onboarding", onboardingIdFor(employeeId));
  return node ? (node.data as OnboardingData) : undefined;
}

function defaultTemplate(
  employeeId: string,
  lead: string | undefined,
  now: string,
): OnboardingStep[] {
  return [
    {
      id: "team-intro",
      title: "Team introduction",
      owner: lead ?? "shruti",
      dueAt: addDays(now, 1),
      status: "pending",
    },
    {
      id: "it-setup",
      title: "IT setup (laptop + accounts)",
      owner: "shruti",
      dueAt: addDays(now, 2),
      status: "pending",
    },
    {
      id: "policy-ack",
      title: "Acknowledge policies",
      owner: employeeId,
      dueAt: addDays(now, 3),
      status: "pending",
    },
  ];
}

export function joiningStartHandler(
  graph: RecordStore,
): OperationHandler<{
  employeeId: string;
  steps?: Array<{ title: string; owner: string; dueAt: string }>;
}> {
  return {
    name: "joining.start",
    category: "people",
    validate: (args) => {
      if (!args.employeeId) {
        return { ok: false, missing: ["employeeId"], detail: "An employee id is required." };
      }
      return { ok: true };
    },
    permission: (args) => ({
      action: "create",
      nodeType: "onboarding",
      recordNodeIds: [onboardingIdFor(args.employeeId)],
    }),
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const now = ctx.now();
      const lead = teamLeadOf(args.employeeId);
      const steps: OnboardingStep[] =
        args.steps && args.steps.length > 0
          ? args.steps.map((s, i) => ({
              id: `step-${i + 1}`,
              title: s.title,
              owner: s.owner,
              dueAt: s.dueAt,
              status: "pending" as const,
            }))
          : defaultTemplate(args.employeeId, lead, now);
      const data: OnboardingData = {
        employeeId: args.employeeId,
        startedAt: now,
        status: "active",
        steps,
      };
      await graph.putNode("onboarding", onboardingIdFor(args.employeeId), data);
      const owners = new Set(steps.map((s) => s.owner));
      const result: OperationResult = {
        changes: [
          {
            nodeType: "onboarding",
            nodeId: onboardingIdFor(args.employeeId),
            after: data,
          },
        ],
        publishedTo: [...owners].map((actor) => ({ kind: "actor" as const, actor })),
        response: { onboardingId: onboardingIdFor(args.employeeId), steps },
      };
      return result;
    },
  };
}

export function joiningCompleteStepHandler(
  graph: RecordStore,
): OperationHandler<{ employeeId: string; stepId: string }> {
  return {
    name: "joining.completeStep",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.stepId) missing.push("stepId");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "Employee id and step id are required." };
    },
    permission: async (args) => {
      const onboarding = await readOnboarding(graph, args.employeeId);
      const step = onboarding?.steps.find((s) => s.id === args.stepId);
      return {
        action: "edit",
        nodeType: "onboarding",
        recordNodeIds: [onboardingIdFor(args.employeeId)],
        allowedActors: step ? [step.owner] : undefined,
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const before = await readOnboarding(graph, args.employeeId);
      if (!before) {
        throw new Error(`No onboarding found for ${args.employeeId}`);
      }
      const steps = before.steps.map((s) =>
        s.id === args.stepId
          ? {
              ...s,
              status: "done" as const,
              completedAt: ctx.now(),
              completedBy: ctx.actor,
            }
          : s,
      );
      const updated: OnboardingData = {
        ...before,
        steps,
        status: steps.every((s) => s.status === "done") ? "complete" : "active",
      };
      await graph.putNode("onboarding", onboardingIdFor(args.employeeId), updated);
      const result: OperationResult = {
        changes: [
          {
            nodeType: "onboarding",
            nodeId: onboardingIdFor(args.employeeId),
            before: { status: before.status },
            after: { status: updated.status, step: args.stepId },
          },
        ],
        undo: {
          description: `Reopen onboarding step ${args.stepId}.`,
          revert: async () => {
            await graph.putNode("onboarding", onboardingIdFor(args.employeeId), before);
          },
        },
        publishedTo: [{ kind: "actor", actor: before.employeeId }],
      };
      return result;
    },
  };
}

export async function findOverdueSteps(
  graph: RecordStore,
  asOf: string,
): Promise<Array<{ employeeId: string; step: OnboardingStep }>> {
  const overdue: Array<{ employeeId: string; step: OnboardingStep }> = [];
  const onboardings = (await graph.find("onboarding", () => true)) as RecordNode[];
  for (const node of onboardings) {
    const data = node.data as OnboardingData;
    if (data.status === "complete") continue;
    for (const step of data.steps ?? []) {
      if (step.status === "pending" && step.dueAt < asOf) {
        overdue.push({ employeeId: data.employeeId, step });
      }
    }
  }
  return overdue;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
