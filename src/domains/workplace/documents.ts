import type { OperationHandler } from "@/spine/operation/registry";
import type { NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

interface DocumentData {
  name: string;
  nodeType: string;
  nodeId: NodeId;
  contentType: string;
  blobRef?: string;
  version: number;
  required?: boolean;
  requiredBy?: string;
  expiresOn?: string;
  roleAccess: string[];
  [key: string]: unknown;
}

export function documentStoreHandler(
  graph: RecordStore,
): OperationHandler<{
  name: string;
  nodeType: string;
  nodeId: NodeId;
  contentType?: string;
  blobRef?: string;
  required?: boolean;
  expiresOn?: string;
  roleAccess?: string[];
}> {
  return {
    name: "document.store",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.name) missing.push("name");
      if (!args.nodeType || !args.nodeId) missing.push("nodeType/nodeId");
      return missing.length === 0 ? { ok: true } : { ok: false, missing, detail: "name, nodeType and nodeId are required." };
    },
    permission: () => ({ action: "create", nodeType: "document" }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      const existing = graph.find(
        "document",
        (n) =>
          (n.data as { name?: string; nodeId?: string }).name === args.name &&
          (n.data as { nodeId?: string }).nodeId === args.nodeId,
      );
      const version =
        existing.length === 0
          ? 1
          : ((existing[0].data as { version?: number }).version ?? 0) + 1;
      const id = `doc_${Date.now().toString(36)}_${version}`;
      const data: DocumentData = {
        name: args.name,
        nodeType: args.nodeType,
        nodeId: args.nodeId,
        contentType: args.contentType ?? "application/octet-stream",
        blobRef: args.blobRef,
        version,
        required: args.required,
        expiresOn: args.expiresOn,
        roleAccess: args.roleAccess ?? ["employee", "manager", "hr"],
      };
      graph.putNode("document", id, data);
      graph.addEdge({ from: args.nodeId, to: id, type: "documented-by" });
      return {
        changes: [{ nodeType: "document", nodeId: id, after: data }],
        publishedTo: [{ kind: "record", nodeType: args.nodeType, nodeId: args.nodeId }],
        response: { documentId: id, version, storedBy: ctx.actor },
      };
    },
  };
}

export function documentRequireHandler(
  graph: RecordStore,
): OperationHandler<{ nodeType: string; nodeId: NodeId; name: string; requiredBy?: string }> {
  return {
    name: "document.require",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.nodeType || !args.nodeId) missing.push("nodeType/nodeId");
      if (!args.name) missing.push("name");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: () => ({ action: "create", nodeType: "document" }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const id = `req_${Date.now().toString(36)}`;
      const data = {
        name: args.name,
        nodeType: args.nodeType,
        nodeId: args.nodeId,
        required: true,
        requiredBy: args.requiredBy,
        version: 0,
        roleAccess: [],
      };
      graph.putNode("document", id, data);
      return {
        changes: [{ nodeType: "document", nodeId: id, after: data }],
        publishedTo: [{ kind: "record", nodeType: args.nodeType, nodeId: args.nodeId }],
      };
    },
  };
}

export function findExpiringDocuments(
  graph: RecordStore,
  asOf: string,
  withinDays: number,
): Array<{ id: NodeId; name: string; expiresOn: string; daysLeft: number }> {
  const out: Array<{ id: NodeId; name: string; expiresOn: string; daysLeft: number }> = [];
  const asOfMs = new Date(asOf).getTime();
  for (const node of graph.find("document", () => true)) {
    const d = node.data as { expiresOn?: string; name?: string };
    if (!d.expiresOn) continue;
    const left = Math.ceil((new Date(d.expiresOn).getTime() - asOfMs) / (1000 * 60 * 60 * 24));
    if (left <= withinDays) {
      out.push({ id: node.id, name: d.name ?? node.id, expiresOn: d.expiresOn, daysLeft: left });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

export function requiredVsSupplied(
  graph: RecordStore,
  nodeType: string,
  nodeId: NodeId,
): { missing: string[]; supplied: string[] } {
  const docs = graph
    .find("document", (n) => (n.data as { nodeType?: string; nodeId?: string }).nodeType === nodeType && (n.data as { nodeId?: string }).nodeId === nodeId)
    .map((n) => n.data as { name?: string; required?: boolean; version?: number });
  const required = new Set(
    docs.filter((d) => d.required).map((d) => d.name).filter((n): n is string => !!n),
  );
  const supplied = new Set(
    docs.filter((d) => (d.version ?? 0) > 0).map((d) => d.name).filter((n): n is string => !!n),
  );
  return {
    missing: [...required].filter((r) => !supplied.has(r)),
    supplied: [...supplied],
  };
}
