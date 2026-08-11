import { describe, it, expect } from "vitest";
import { N1ReadThroughService } from "@/server/n1-readthrough";
import { buildDemoWorld } from "@/server/bootstrap";

describe("N1ReadThroughService — graph read + registry", () => {
  it("read returns a seeded payslip node in stub mode", async () => {
    const { deps } = await buildDemoWorld();
    const service = new N1ReadThroughService(deps.graph);
    const node = await service.read("payslip", "payslip-demo");
    expect(node).toBeDefined();
    expect(node?.data.employee).toBeTruthy();
    expect(node?.data.netPay).toBeTruthy();
  });

  it("list returns seeded nodes for a node type", async () => {
    const { deps } = await buildDemoWorld();
    const service = new N1ReadThroughService(deps.graph);
    const applicants = await service.list("job-applicant");
    expect(applicants.length).toBeGreaterThan(0);
    const slabs = await service.list("income-tax-slab");
    expect(slabs.length).toBeGreaterThan(0);
  });

  it("read returns undefined for an unknown id", async () => {
    const { deps } = await buildDemoWorld();
    const service = new N1ReadThroughService(deps.graph);
    expect(await service.read("payslip", "does-not-exist")).toBeUndefined();
  });

  it("mappingsByCategory groups every supported doctype into 8 categories", async () => {
    const { deps } = await buildDemoWorld();
    const service = new N1ReadThroughService(deps.graph);
    const groups = service.mappingsByCategory();
    expect(Object.keys(groups).length).toBe(8);
    expect(groups.payroll.length).toBeGreaterThan(0);
    expect(groups.recruitment.length).toBeGreaterThan(0);
  });

  it("mapping() resolves a node type to its doctype", async () => {
    const { deps } = await buildDemoWorld();
    const service = new N1ReadThroughService(deps.graph);
    expect(service.mapping("payslip")?.doctype).toBe("Salary Slip");
    expect(service.mapping("training-event")?.category).toBe("training");
  });
});

describe("permission gating — sensitive N1 node types", () => {
  it("hr can view+export payslips; an employee cannot (export ≠ view holds)", async () => {
    const { deps } = await buildDemoWorld();
    expect(deps.permissions.can({ actor: "shruti", action: "view", nodeType: "payslip" }).allowed).toBe(true);
    expect(deps.permissions.can({ actor: "shruti", action: "export", nodeType: "payslip" }).allowed).toBe(true);
    expect(deps.permissions.can({ actor: "priya", action: "view", nodeType: "payslip" }).allowed).toBe(false);
    expect(deps.permissions.can({ actor: "priya", action: "export", nodeType: "payslip" }).allowed).toBe(false);
  });

  it("any role can view a non-sensitive DocType; only hr/admin edit", async () => {
    const { deps } = await buildDemoWorld();
    expect(deps.permissions.can({ actor: "ravi", action: "view", nodeType: "leave-type" }).allowed).toBe(true);
    expect(deps.permissions.can({ actor: "priya", action: "view", nodeType: "job-applicant" }).allowed).toBe(true);
    expect(deps.permissions.can({ actor: "shruti", action: "edit", nodeType: "leave-type" }).allowed).toBe(true);
    expect(deps.permissions.can({ actor: "priya", action: "edit", nodeType: "leave-type" }).allowed).toBe(false);
  });

  it("spine.read hides payslips from an employee (opaque refusal)", async () => {
    const { spine } = await buildDemoWorld();
    const read = await spine.read({ actor: "priya", nodeType: "payslip", nodeId: "HR-SAL-2026-07-priya" });
    expect(read.found).toBe(false);
  });
});
