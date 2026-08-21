import { n1Mode } from "@/config/env";
import type { N1Provider } from "@/config/providers";
import { mapAttendance, mapEmployee } from "./n1-mapping";
import type { RecordNode } from "@/spine/record/types";
import type { RecordStore } from "@/spine/record/types";

export class PeopleRecordService {
  constructor(
    private readonly graph: RecordStore,
    private readonly n1: N1Provider,
  ) {}

  async getEmployee(id: string): Promise<RecordNode | undefined> {
    if (n1Mode() === "live") {
      const rec = await this.n1.get("Employee", id);
      if (rec) {
        const mapped = mapEmployee(rec);
        await this.graph.putNode("employee", mapped.nodeId, mapped.data);
      }
    }
    return this.graph.getNode("employee", id);
  }

  async listEmployees(): Promise<RecordNode[]> {
    if (n1Mode() === "live") {
      const recs = await this.n1.list("Employee");
      for (const rec of recs) {
        const mapped = mapEmployee(rec);
        await this.graph.putNode("employee", mapped.nodeId, mapped.data);
      }
    }
    return this.graph.find("employee", () => true);
  }

  async getLeaveBalance(id: string): Promise<number | undefined> {
    const node = await this.getEmployee(id);
    return (node?.data as { leaveBalance?: number })?.leaveBalance;
  }

  async listAttendance(employeeId: string): Promise<RecordNode[]> {
    if (n1Mode() === "live") {
      const recs = await this.n1.list("Attendance", { employee: employeeId });
      for (const rec of recs) {
        const mapped = mapAttendance(rec);
        await this.graph.putNode("attendance", mapped.nodeId, mapped.data);
      }
    }
    // Records written by attendance.checkIn use `employeeId`; rows synced
    // from N1 use `employee`. Match either, or /me shows an empty history.
    return this.graph.find("attendance", (n) => {
      const d = n.data as { employee?: string; employeeId?: string };
      return d.employeeId === employeeId || d.employee === employeeId;
    });
  }

  // Payslips are deliberately not surfaced anywhere right now (product call,
  // 2026-08). The payslip node type, seed and permission rules remain so the
  // feature can return without re-plumbing.
}
