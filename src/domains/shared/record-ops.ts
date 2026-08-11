import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordData, RecordStore } from "@/spine/record/types";
import { n1Mode } from "@/config/env";
import { providers } from "@/config/providers";
import { doctypeForNodeType } from "@/domains/people/n1-doctypes";

/**
 * Generic record operations — let any mapped DocType be created, edited, and
 * deleted from the /records browser. All three go through the gate (permission
 * + activity log + undo). In live N1 mode they also write back to Frappe.
 */

export function recordCreateHandler(
  graph: RecordStore,
): OperationHandler<{ nodeType: string; data: RecordData; id?: string }> {
  return {
    name: "record.create",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.nodeType) missing.push("nodeType");
      if (!args.data) missing.push("data");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({ action: "create", nodeType: args.nodeType }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const id = args.id ?? `${args.nodeType}_${Date.now().toString(36)}`;
      await graph.putNode(args.nodeType, id, args.data);
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
    permission: (args) => ({
      action: "edit",
      nodeType: args.nodeType,
      recordNodeIds: [args.nodeId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const before = await graph.getNode(args.nodeType, args.nodeId);
      if (!before) throw new Error(`No ${args.nodeType}:${args.nodeId}`);
      await graph.patchNode(args.nodeType, args.nodeId, args.data);
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
