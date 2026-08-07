import type { ActorId, NodeId } from "../operation/types";
import { RESTRICTED, type FieldPolicy, type RestrictedField } from "./types";

export type FilteredRecord = Record<string, unknown>;

export function applyFieldPolicy(
  record: Record<string, unknown>,
  policy: FieldPolicy,
): FilteredRecord {
  if (policy.kind === "all-visible") {
    return { ...record };
  }
  const out: FilteredRecord = {};
  const visible = new Set(policy.visible);
  const restricted = new Set(policy.restricted);
  for (const [field, value] of Object.entries(record)) {
    if (visible.has(field)) {
      out[field] = value;
    } else if (restricted.has(field)) {
      out[field] = markRestricted();
    }
  }
  for (const field of restricted) {
    if (!(field in out)) {
      out[field] = markRestricted();
    }
  }
  return out;
}

function markRestricted(): RestrictedField {
  return RESTRICTED;
}

export function filterRecordForActor(input: {
  record: Record<string, unknown>;
  policy: FieldPolicy;
  actor: ActorId;
  nodeType: string;
  nodeId: NodeId;
}): FilteredRecord {
  return applyFieldPolicy(input.record, input.policy);
}
