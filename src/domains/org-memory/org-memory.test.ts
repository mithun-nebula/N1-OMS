import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { OrgMemoryService } from "./service";

function world() {
  return buildDemoWorld();
}

describe("orgMemory.record — recording a decision (manager/hr/admin)", () => {
  it("a manager records an org-memory with linked records", async () => {
    const { spine, deps } = await world();
    const res = await spine.submit(
      adapters.fromTyped({
        actor: "james",
        name: "orgMemory.record",
        args: {
          title: "Drop the shadow period",
          decision: "Reduce shadowing from two weeks to one.",
          reason: "Team is experienced enough now.",
          linkedRecords: [
            { nodeType: "employee", nodeId: "shruti" },
            { nodeType: "course", nodeId: "ai-basics" },
          ],
        },
      }),
    );
    expect(res.status).toBe("ran");
    const memoryId = (res.result?.response as { memoryId: string }).memoryId;
    expect(((await deps.graph.getNode("org-memory", memoryId))?.data as { decision: string }).decision).toContain("one");
  });

  it("an intern cannot record (create is manager/hr/admin)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromTyped({
        actor: "ravi",
        name: "orgMemory.record",
        args: { title: "x", decision: "y", reason: "z" },
      }),
    );
    expect(res.status).toBe("forbidden");
  });
});

describe("orgMemory.retrieve — permission-gated linked records", () => {
  it("includes only links the viewer can open (employee sees course, not other-team employee)", async () => {
    const { spine, deps } = await world();
    const res = await spine.submit(
      adapters.fromTyped({
        actor: "james",
        name: "orgMemory.record",
        args: {
          title: "t",
          decision: "d",
          reason: "r",
          linkedRecords: [
            { nodeType: "employee", nodeId: "shruti" },
            { nodeType: "course", nodeId: "ai-basics" },
          ],
        },
      }),
    );
    const memoryId = (res.result?.response as { memoryId: string }).memoryId;
    const service = new OrgMemoryService(deps.graph);
    const view = (await service.retrieve(memoryId, async (nodeType, nodeId) =>
      (await spine.read({ actor: "arun", nodeType, nodeId })).found,
    ))!;
    const shrutiLink = view.linkedRecords.find((l) => l.nodeId === "shruti");
    const courseLink = view.linkedRecords.find((l) => l.nodeId === "ai-basics");
    expect(shrutiLink?.available).toBe(false);
    expect(courseLink?.available).toBe(true);
  });

  it("an admin sees all linked records", async () => {
    const { spine, deps } = await world();
    const res = await spine.submit(
      adapters.fromTyped({
        actor: "james",
        name: "orgMemory.record",
        args: {
          title: "t",
          decision: "d",
          reason: "r",
          linkedRecords: [
            { nodeType: "employee", nodeId: "shruti" },
            { nodeType: "course", nodeId: "ai-basics" },
          ],
        },
      }),
    );
    const memoryId = (res.result?.response as { memoryId: string }).memoryId;
    const service = new OrgMemoryService(deps.graph);
    const view = (await service.retrieve(memoryId, async (nodeType, nodeId) =>
      (await spine.read({ actor: "admin", nodeType, nodeId })).found,
    ))!;
    expect(view.linkedRecords.every((l) => l.available)).toBe(true);
  });

  it("seeded memory is retrievable", async () => {
    const { deps, spine } = await world();
    const service = new OrgMemoryService(deps.graph);
    const view = await service.retrieve("memory-shadow-onboarding", async (nodeType, nodeId) =>
      (await spine.read({ actor: "james", nodeType, nodeId })).found,
    );
    expect(view?.title).toContain("Shadow");
  });
});
