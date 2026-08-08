import { describe, it, expect } from "vitest";
import {
  mapEmployee,
  mapLeaveApplication,
  mapAttendance,
  mapN1Record,
} from "./n1-mapping";
import type { N1Record } from "@/config/providers";

function rec(doctype: string, name: string, data: Record<string, unknown>): N1Record {
  return { doctype, name, data };
}

describe("n1 mapping — Employee", () => {
  it("maps Employee fields to an employee record node", () => {
    const out = mapEmployee(
      rec("Employee", "HR-EMP-0001", {
        employee: "HR-EMP-0001",
        employee_name: "Priya R.",
        designation: "course-writer",
        orga_team: "courses",
        orga_role: "employee",
        cell_number: "+91 90000 11111",
        status: "Active",
        company: "Organization A",
        department: "Courses",
        ctc: 84526,
      }),
    );
    expect(out.nodeType).toBe("employee");
    expect(out.nodeId).toBe("HR-EMP-0001");
    expect(out.data.name).toBe("Priya R.");
    expect(out.data.role).toBe("course-writer");
    expect(out.data.team).toBe("courses");
    expect(out.data.contact).toBe("+91 90000 11111");
    expect(out.data.pay).toBe(84526);
    expect(out.data.status).toBe("Active");
  });

  it("falls back to the record name when employee id is missing", () => {
    const out = mapEmployee(rec("Employee", "HR-EMP-0002", { employee_name: "Ravi" }));
    expect(out.nodeId).toBe("HR-EMP-0002");
    expect(out.data.name).toBe("Ravi");
  });
});

describe("n1 mapping — Leave Application", () => {
  it("maps leave fields", () => {
    const out = mapLeaveApplication(
      rec("Leave Application", "HR-LAP-2026-001", {
        employee: "HR-EMP-0001",
        employee_name: "Priya R.",
        from_date: "2026-08-08",
        to_date: "2026-08-08",
        leave_type: "Casual Leave",
        status: "Open",
        description: "Personal",
      }),
    );
    expect(out.nodeType).toBe("leave");
    expect(out.nodeId).toBe("HR-LAP-2026-001");
    expect(out.data.fromDate).toBe("2026-08-08");
    expect(out.data.toDate).toBe("2026-08-08");
    expect(out.data.status).toBe("Open");
  });
});

describe("n1 mapping — Attendance", () => {
  it("maps attendance fields", () => {
    const out = mapAttendance(
      rec("Attendance", "HR-ATT-001", {
        employee: "HR-EMP-0001",
        attendance_date: "2026-08-07",
        status: "Present",
        in_time: "2026-08-07 10:05:00",
        out_time: "2026-08-07 18:02:00",
      }),
    );
    expect(out.nodeType).toBe("attendance");
    expect(out.data.date).toBe("2026-08-07");
    expect(out.data.status).toBe("Present");
    expect(out.data.inTime).toContain("10:05");
  });
});

describe("n1 mapping — dispatch", () => {
  it("routes by doctype and falls back for unknown types", () => {
    const emp = mapN1Record(rec("Employee", "E1", { employee_name: "X" }));
    expect(emp.nodeType).toBe("employee");
    const other = mapN1Record(rec("Asset", "A1", { asset_name: "Projector" }));
    expect(other.nodeType).toBe("asset");
    expect(other.nodeId).toBe("A1");
  });
});
