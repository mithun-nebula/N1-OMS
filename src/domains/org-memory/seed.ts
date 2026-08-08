import type { DomainContext } from "../types";

export function seedOrgMemory(ctx: DomainContext): void {
  ctx.graph.putNode(
    "org-memory",
    "memory-shadow-onboarding",
    {
      title: "Shadow-onboarding for new hires",
      decision:
        "New hires shadow a buddy for two weeks before taking ownership of a course.",
      reasonAtTime:
        "Domain knowledge transfer is the bottleneck; shadowing reduced first-month errors.",
      decidedBy: "james",
      decidedAt: "2025-03-12T09:00:00.000Z",
      linkedRecords: [
        { nodeType: "employee", nodeId: "james" },
        { nodeType: "course", nodeId: "ai-basics" },
      ],
    },
  );
  ctx.graph.addEdge({
    from: "memory-shadow-onboarding",
    to: "james",
    type: "references",
  });
  ctx.graph.addEdge({
    from: "memory-shadow-onboarding",
    to: "ai-basics",
    type: "references",
  });
}
