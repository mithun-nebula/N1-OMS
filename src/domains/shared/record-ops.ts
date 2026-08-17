import {
  PERSON_SCOPED_NODE_TYPES,
  ownerOfRecordData,
} from "@/domains/people/n1-classification";
import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordData, RecordStore } from "@/spine/record/types";
import { n1Mode } from "@/config/env";
import { providers } from "@/config/providers";
import { doctypeForNodeType } from "@/domains/people/n1-doctypes";

/**
 * Node types whose contents are money or employment, whichever route reaches
 * them. `record.*` takes its nodeType as a caller argument, so a static flag
 * cannot express its risk — a generic update is harmless on a room and is a
 * pay change on an employee.
 */
const MONEY_OR_PEOPLE_NODE_TYPES = new Set([
  "employee",
  "payslip",
  "salary-structure",
  "salary-slip",
  "leave",
  "onboarding",
  "offboarding",
  "expense-claim",
  "employee-advance",
]);

const MONEY_OR_PEOPLE_FIELDS = new Set([
  "pay",
  "salary",
  "grossPay",
  "netPay",
  "ctc",
  "role",
  "status",
  "performance",
]);

function touchesMoneyOrPeople(nodeType: string, data?: RecordData): boolean {
  if (MONEY_OR_PEOPLE_NODE_TYPES.has(nodeType)) return true;
  return Object.keys(data ?? {}).some((f) => MONEY_OR_PEOPLE_FIELDS.has(f));
}

/**
 * Keep the person-scope owner index current: a person-scoped record created or
 * edited at runtime must resolve its owner without waiting for the next
 * restart's hydration pass. Unknown owner fails closed (record hidden).
 */
function registerOwner(
  owners: Map<string, string> | undefined,
  nodeType: string,
  nodeId: string,
  data: Record<string, unknown>,
): void {
  if (!owners || !PERSON_SCOPED_NODE_TYPES.has(nodeType)) return;
  const owner = ownerOfRecordData(data);
  if (owner) owners.set(`${nodeType}:${nodeId}`, owner);
}

/**
 * Generic record operations — let any mapped DocType be created, edited, and
 * deleted from the /records browser. All three go through the gate (permission
 * + activity log + undo). In live N1 mode they also write back to Frappe.
 */

export function recordCreateHandler(
  graph: RecordStore,
  owners?: Map<string, string>,
): OperationHandler<{ nodeType: string; data: RecordData; id?: string }> {
  return {
    name: "record.create",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.nodeType) missing.push("nodeType");
      if (!args.data) missing.push("data");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({
      action: "create",
      nodeType: args.nodeType,
      fields: Object.keys(args.data ?? {}),
    }),
    involvesMoneyOrPeople: (args) => touchesMoneyOrPeople(args.nodeType, args.data),
    category: "routine",
    execute: async (args) => {
      const id = args.id ?? `${args.nodeType}_${Date.now().toString(36)}`;
      await graph.putNode(args.nodeType, id, args.data);
      registerOwner(owners, args.nodeType, id, args.data);
      await n1WriteThrough(args.nodeType, id, args.data, "create");
      const result: OperationResult = {
        changes: [{ nodeType: args.nodeType, nodeId: id, after: args.data }],
        undo: {
          description: `Delete ${args.nodeType}:${id}.`,
          revert: async () => { await graph.removeNode(args.nodeType, id); },
        },
        response: { id },
      };
      return result;
    },
  };
}

export function recordUpdateHandler(
  graph: RecordStore,
  owners?: Map<string, string>,
): OperationHandler<{ nodeType: string; nodeId: string; data: RecordData }> {
  return {
    name: "record.update",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.nodeType) missing.push("nodeType");
      if (!args.nodeId) missing.push("nodeId");
      if (!args.data) missing.push("data");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    // Declaring the fields is what makes the field-permission layer run at
    // all: `PermissionPolicy.can` only tests fields when it is told which
    // ones. Without this line, `record.update` wrote any field on any record
    // the actor could edit — including `pay` on their own employee record,
    // which the employee/self/edit rule marks restricted.
    permission: (args) => ({
      action: "edit",
      nodeType: args.nodeType,
      recordNodeIds: [args.nodeId],
      fields: Object.keys(args.data ?? {}),
    }),
    involvesMoneyOrPeople: (args) => touchesMoneyOrPeople(args.nodeType, args.data),
    category: "routine",
    execute: async (args) => {
      const before = await graph.getNode(args.nodeType, args.nodeId);
      if (!before) throw new Error(`No ${args.nodeType}:${args.nodeId}`);
      await graph.patchNode(args.nodeType, args.nodeId, args.data);
      registerOwner(owners, args.nodeType, args.nodeId, args.data);
      await n1WriteThrough(args.nodeType, args.nodeId, args.data, "update");
      const result: OperationResult = {
        changes: [{
          nodeType: args.nodeType,
          nodeId: args.nodeId,
          before: before.data,
          after: args.data,
        }],
        undo: {
          description: `Revert ${args.nodeType}:${args.nodeId}.`,
          revert: async () => { await graph.putNode(args.nodeType, args.nodeId, before.data); },
        },
      };
      return result;
    },
  };
}

export function recordDeleteHandler(
  graph: RecordStore,
): OperationHandler<{ nodeType: string; nodeId: string }> {
  return {
    name: "record.delete",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.nodeType) missing.push("nodeType");
      if (!args.nodeId) missing.push("nodeId");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({
      action: "delete",
      nodeType: args.nodeType,
      recordNodeIds: [args.nodeId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const before = await graph.getNode(args.nodeType, args.nodeId);
      await graph.removeNode(args.nodeType, args.nodeId);
      const result: OperationResult = {
        changes: [{ nodeType: args.nodeType, nodeId: args.nodeId, before: before?.data }],
        undo: {
          description: `Restore ${args.nodeType}:${args.nodeId}.`,
          revert: async () => {
            if (before) await graph.putNode(args.nodeType, args.nodeId, before.data);
          },
        },
      };
      return result;
    },
  };
}

/** Write-through to Frappe/N1 when live (best-effort — silent on failure). */
async function n1WriteThrough(
  nodeType: string,
  nodeId: string,
  data: RecordData,
  op: "create" | "update",
): Promise<void> {
  if (n1Mode() !== "live") return;
  const doctype = doctypeForNodeType(nodeType);
  if (!doctype) return;
  try {
    if (op === "create") await providers().n1.create(doctype, data);
    else await providers().n1.update(doctype, nodeId, data);
  } catch {
    /* best-effort — local store is still updated */
  }
}
