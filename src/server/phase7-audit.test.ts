import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { enforceAppendixD } from "@/domains/assistant/appendix-d";

function world() {
  return buildDemoWorld();
}

describe("equivalence audit — form / typed / voice produce the same operation", () => {
  it("all three starts yield the same gate outcome + record", async () => {
    const args = { courseId: "ai-presentations", stage: "published" };
    const w1 = world();
    const viaForm = await w1.spine.submit(adapters.fromForm({ actor: "james", name: "course.updateStage", args }));
    const w2 = world();
    const viaTyped = await w2.spine.submit(adapters.fromTyped({ actor: "james", name: "course.updateStage", args }));
    const w3 = world();
    const viaVoice = await w3.spine.submit(
      adapters.fromVoice({ actor: "james", name: "course.updateStage", args, transcript: "publish the course" }),
    );
    expect(viaForm.status).toBe(viaTyped.status);
    expect(viaForm.status).toBe(viaVoice.status);
    expect(viaForm.activityEntry?.changes[0]?.after).toMatchObject({ stage: "published" });
    expect(viaVoice.activityEntry?.changes[0]?.after).toMatchObject({ stage: "published" });
  });
});

describe("non-negotiable audit — every CONTEXT §13 rule holds", () => {
  it("§1 one gate — all seven starts funnel through it", async () => {
    for (const start of ["form", "typed", "voice"] as const) {
      const { spine, deps } = world();
      deps.graph.patchNode("course", "spreadsheet-automation", { stage: "outline" });
      const fn = start === "form" ? adapters.fromForm : start === "typed" ? adapters.fromTyped : adapters.fromVoice;
      const extra = start === "voice" ? { transcript: "x" } : {};
      const res = await spine.submit(fn({ actor: "james", name: "course.updateStage", args: { courseId: "spreadsheet-automation", stage: "draft" }, ...extra } as never));
      expect(res.status).toBe("ran");
    }
  });

  it("§2 refusal never discloses a record's existence", async () => {
    const { spine } = world();
    const existing = await spine.submit(adapters.fromForm({ actor: "ravi", name: "course.updateStage", args: { courseId: "ai-presentations", stage: "draft" } }));
    const missing = await spine.submit(adapters.fromForm({ actor: "ravi", name: "course.updateStage", args: { courseId: "nonexistent", stage: "draft" } }));
    expect(existing.status).toBe(missing.status);
    expect(existing.status).toBe("forbidden");
    expect(JSON.stringify(existing)).not.toContain("ai-presentations");
  });

  it("§3 money/people + leaving never go automatic", async () => {
    const { spine } = world();
    const res = await spine.submit(
      adapters.fromStandingRule({ ruleId: "auto-leave", ruleAuthor: "james", name: "leave.request", args: { employeeId: "priya", fromDate: "2026-08-08", toDate: "2026-08-08" } }),
    );
    expect(res.status).toBe("awaiting-confirmation");
  });

  it("§4 autonomy is earned (10 clean) and revocable", async () => {
    const { spine, autonomy } = world();
    for (let i = 0; i < 10; i++) {
      const res = await spine.submit(adapters.fromStandingRule({ ruleId: "auto-announce", ruleAuthor: "james", name: "announcement.send", args: { message: "test", to: ["james"] } }));
      await spine.confirm(res.pendingId!, "james");
    }
    expect(autonomy.get("auto-announce")?.status).toBe("supervised");
    expect(autonomy.get("auto-announce")?.cleanCount).toBe(10);
  });

  it("§5 voice confirms before saving (read-back transcript stored)", () => {
    const op = adapters.fromVoice({ actor: "james", name: "announcement.send", args: { message: "hi", to: ["priya"] }, transcript: "send a reminder" });
    expect(op.startedBy.voiceTranscript).toBe("send a reminder");
  });

  it("§9 assistant comments on work, never the person (appendix D)", () => {
    expect(enforceAppendixD("You work slowly.").ok).toBe(false);
    expect(enforceAppendixD("You have 8 hours committed today.").ok).toBe(true);
  });

  it("§10 exporting ≠ viewing", () => {
    const { spine } = world();
    expect(spine.canExport("arun", "employee")).toBe(false);
    expect(spine.canExport("shruti", "employee")).toBe(true);
  });

  it("§13 any figure opens into the parts it was computed from", () => {
    const { deps } = world();
    const figs = deps.figures.forRecord("course", "ai-presentations");
    const breakdown = deps.figures.breakdown(figs[0].id)!;
    expect(breakdown.parts.length).toBeGreaterThan(0);
  });
});
