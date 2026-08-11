import { describe, it, expect } from "vitest";
import {
  SUPPORTED_DOCTYPES,
  mappingForDoctype,
  mappingForNodeType,
  doctypeForNodeType,
  categoryForNodeType,
  isSensitiveNodeType,
  doctypesByCategory,
  applyFieldMap,
} from "./n1-doctypes";
import type { N1Record } from "@/config/providers";

function rec(doctype: string, name: string, data: Record<string, unknown>): N1Record {
  return { doctype, name, data };
}

describe("n1-doctypes registry — coverage", () => {
  it("registers all 149 unmapped DocTypes + the 3 already-mapped", () => {
    expect(SUPPORTED_DOCTYPES.length).toBeGreaterThanOrEqual(149);
  });

  it("every DocType has a unique nodeType", () => {
    const nodeTypes = SUPPORTED_DOCTYPES.map((m) => m.nodeType);
    expect(new Set(nodeTypes).size).toBe(nodeTypes.length);
  });

  it("every DocType round-trips doctype ↔ nodeType", () => {
    for (const m of SUPPORTED_DOCTYPES) {
      expect(mappingForDoctype(m.doctype)?.nodeType).toBe(m.nodeType);
      expect(doctypeForNodeType(m.nodeType)).toBe(m.doctype);
      expect(mappingForNodeType(m.nodeType)?.doctype).toBe(m.doctype);
    }
  });

  it("covers all eight categories", () => {
    const cats = new Set(SUPPORTED_DOCTYPES.map((m) => m.category));
    expect(cats).toEqual(
      new Set([
        "payroll",
        "recruitment",
        "leave",
        "expense",
        "attendance",
        "performance",
        "training",
        "lifecycle",
      ]),
    );
  });
});

describe("n1-doctypes registry — sensitivity", () => {
  it("flags payroll/appraisal/tax as sensitive, structures as not", () => {
    expect(isSensitiveNodeType("payslip")).toBe(true);
    expect(isSensitiveNodeType("appraisal")).toBe(true);
    expect(isSensitiveNodeType("income-tax-slab")).toBe(true);
    expect(isSensitiveNodeType("expense-claim")).toBe(true);
    expect(isSensitiveNodeType("salary-structure")).toBe(true);
    expect(isSensitiveNodeType("leave-type")).toBe(false);
    expect(isSensitiveNodeType("job-applicant")).toBe(false);
    expect(isSensitiveNodeType("shift-type")).toBe(false);
  });
});

describe("n1-doctypes registry — field mapping", () => {
  it("camelCases snake_case fields and applies renames", () => {
    const m = mappingForDoctype("Expense Claim")!;
    const out = applyFieldMap(
      rec("Expense Claim", "EXP-1", {
        employee: "priya",
        expense_date: "2026-08-03",
        total_amount: 4200,
        status: "Draft",
      }),
      m,
    );
    expect(out.nodeType).toBe("expense-claim");
    expect(out.data.employee).toBe("priya");
    expect(out.data.expenseDate).toBe("2026-08-03");
    expect(out.data.totalAmount).toBe(4200);
    expect(out.data.status).toBe("Draft");
  });

  it("doctypesByCategory returns only that category", () => {
    const training = doctypesByCategory("training");
    expect(training.length).toBeGreaterThan(0);
    expect(training.every((m) => m.category === "training")).toBe(true);
    expect(training.map((m) => m.doctype)).toContain("Training Event");
  });

  it("categoryForNodeType resolves", () => {
    expect(categoryForNodeType("job-applicant")).toBe("recruitment");
    expect(categoryForNodeType("leave-allocation")).toBe("leave");
  });
});
