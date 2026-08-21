import type { OperationHandler } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";

/**
 * Attendance — the slice the day flow stands on.
 *
 * One node per person per day, id `att_<employee>_<YYYY-MM-DD>`, so ownership
 * resolves from the id alone (the gate is synchronous and cannot read the
 * database to find out whose record this is).
 */

export interface AttendanceData {
  employeeId: string;
  date: string;
  checkInAt: string;
  checkOutAt?: string;
  workedMinutes?: number;
  [key: string]: unknown;
}

export function attendanceId(employeeId: string, date: string): string {
  return `att_${employeeId}_${date}`;
}

/** Owner embedded in the id: att_<employee>_<YYYY-MM-DD>. */
export function attendanceOwner(recordNodeId: string): string | undefined {
  const m = /^att_(.+)_(\d{4}-\d{2}-\d{2})$/.exec(recordNodeId);
  return m?.[1];
}

export function attendanceCheckInHandler(
  graph: RecordStore,
): OperationHandler<{ employeeId: string; date: string; at?: string }> {
  return {
    name: "attendance.checkIn",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.date) missing.push("date");
      if (missing.length > 0) return { ok: false, missing };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
        return { ok: false, missing: ["date"], detail: "The date must be YYYY-MM-DD." };
      }
      return { ok: true };
    },
    permission: (args) => ({
      action: "create",
      nodeType: "attendance",
      recordNodeIds: [attendanceId(args.employeeId, args.date)],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      // Clocking in is strictly personal — even a role whose rules could reach
      // another person's attendance may not clock in on their behalf.
      if (args.employeeId !== ctx.actor) {
        throw new Error("You can only clock in as yourself.");
      }
      const id = attendanceId(args.employeeId, args.date);
      const existing = await graph.getNode("attendance", id);
      if ((existing?.data as AttendanceData | undefined)?.checkInAt) {
        throw new Error("Already clocked in today.");
      }
      const data: AttendanceData = {
        employeeId: args.employeeId,
        date: args.date,
        checkInAt: args.at ?? ctx.now(),
      };
      await graph.putNode("attendance", id, data);
      return {
        changes: [{ nodeType: "attendance", nodeId: id, after: { checkInAt: data.checkInAt } }],
        undo: {
          description: "Remove today's clock-in.",
          revert: async () => { await graph.removeNode("attendance", id); },
          // Serialisable, so a mistaken clock-in can still be taken back after
          // a restart — the whole day flow keys off this record.
          plan: [{ op: "remove", nodeType: "attendance", nodeId: id }],
        },
      };
    },
  };
}

export function attendanceCheckOutHandler(
  graph: RecordStore,
): OperationHandler<{ employeeId: string; date: string; at?: string }> {
  return {
    name: "attendance.checkOut",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.date) missing.push("date");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "attendance",
      recordNodeIds: [attendanceId(args.employeeId, args.date)],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      if (args.employeeId !== ctx.actor) {
        throw new Error("You can only clock out as yourself.");
      }
      const id = attendanceId(args.employeeId, args.date);
      const node = await graph.getNode("attendance", id);
      const before = node?.data as AttendanceData | undefined;
      if (!before?.checkInAt) throw new Error("Not clocked in today.");
      if (before.checkOutAt) throw new Error("Already clocked out today.");
      const checkOutAt = args.at ?? ctx.now();
      const workedMinutes = Math.max(
        0,
        Math.round(
          (new Date(checkOutAt).getTime() - new Date(before.checkInAt).getTime()) / 60000,
        ),
      );
      await graph.putNode("attendance", id, { ...before, checkOutAt, workedMinutes });
      return {
        changes: [{ nodeType: "attendance", nodeId: id, after: { checkOutAt, workedMinutes } }],
        undo: {
          description: "Remove the clock-out again.",
          revert: async () => { await graph.putNode("attendance", id, before); },
          plan: [{ op: "put", nodeType: "attendance", nodeId: id, data: before }],
        },
      };
    },
  };
}
