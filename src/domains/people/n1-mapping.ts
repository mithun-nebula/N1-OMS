import type { N1Record } from "@/config/providers";
import type { NodeId } from "@/spine/operation/types";
import type { RecordData } from "@/spine/record/types";
import { mappingForDoctype } from "./n1-doctypes";

export type N1Doctype = "Employee" | "Leave Application" | "Attendance";

export interface MappedEmployee {
  nodeType: "employee";
  nodeId: NodeId;
  data: RecordData;
}

export interface MappedLeave {
  nodeType: "leave";
  nodeId: NodeId;
  data: RecordData;
}

export interface MappedAttendance {
  nodeType: "attendance";
  nodeId: NodeId;
  data: RecordData;
}

export function mapEmployee(record: N1Record): MappedEmployee {
  const d = record.data;
  const id = str(d.employee) ?? record.name;
  return {
    nodeType: "employee",
    nodeId: id,
    data: {
      name: str(d.employee_name) ?? str(d.name) ?? id,
      role: str(d.designation) ?? str(d.orga_role) ?? "employee",
      contact: str(d.cell_number) ?? str(d.personal_email) ?? "",
      status: str(d.status) ?? "active",
      company: str(d.company) ?? null,
      department: str(d.department) ?? null,
      team: str(d.orga_team) ?? null,
      pay: num(d.ctc) ?? null,
    },
  };
}

export function mapLeaveApplication(record: N1Record): MappedLeave {
  const d = record.data;
  const id = record.name;
  return {
    nodeType: "leave",
    nodeId: id,
    data: {
      employee: str(d.employee) ?? "",
      employeeName: str(d.employee_name) ?? "",
      fromDate: str(d.from_date) ?? "",
      toDate: str(d.to_date) ?? "",
      leaveType: str(d.leave_type) ?? "",
      status: str(d.status) ?? "Open",
      description: str(d.description) ?? "",
    },
  };
}

export function mapAttendance(record: N1Record): MappedAttendance {
  const d = record.data;
  const id = record.name;
  return {
    nodeType: "attendance",
    nodeId: id,
    data: {
      employee: str(d.employee) ?? "",
      employeeName: str(d.employee_name) ?? "",
      date: str(d.attendance_date) ?? "",
      status: str(d.status) ?? "Absent",
      inTime: str(d.in_time) ?? null,
      outTime: str(d.out_time) ?? null,
    },
  };
}

export function mapN1Record(record: N1Record): {
  nodeType: string;
  nodeId: NodeId;
  data: RecordData;
} {
  switch (record.doctype) {
    case "Employee":
      return mapEmployee(record);
    case "Leave Application":
      return mapLeaveApplication(record);
    case "Attendance":
      return mapAttendance(record);
  }
  const mapping = mappingForDoctype(record.doctype);
  if (mapping) {
    const renames = mapping.fields ?? {};
    const data: RecordData = {};
    for (const [key, value] of Object.entries(record.data)) {
      const target = renames[key] ?? toCamel(key);
      if (!(target in data)) data[target] = value;
    }
    const id =
      (mapping.idField ? str(record.data[renames[mapping.idField] ?? mapping.idField]) : undefined) ??
      record.name;
    return { nodeType: mapping.nodeType, nodeId: id, data };
  }
  return {
    nodeType: record.doctype.toLowerCase().replace(/\s+/g, "-"),
    nodeId: record.name,
    data: record.data,
  };
}

function toCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : undefined;
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
