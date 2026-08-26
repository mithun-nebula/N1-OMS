import type { ToolSpec } from "../catalogue";
import { buildWriteTool, type WriteToolSpec } from "./build";
import { peopleWriteTools } from "./people";
import { workplaceWriteTools } from "./workplace";
import { workWriteTools } from "./work";
import { extraWriteTools } from "./extras";
import { approveProposal, discardProposal } from "./approve";

/**
 * The write catalogue.
 *
 * **Fifty-six operations become tools, and three do not.** `record.create`,
 * `record.update` and `record.delete` are never tools — a standing decision, not
 * an oversight. They browse 162 raw N1 doctypes and were the source of the pay
 * hole; there is no version of Phase 3 in which a model gets a generic
 * write-any-record verb.
 *
 * Plus two that are not spine operations at all: `send_message` and
 * `undo_last`.
 */

export const WRITE_SPECS: readonly WriteToolSpec[] = [
  ...peopleWriteTools,
  ...workplaceWriteTools,
  ...workWriteTools,
];

/** ⚠ Never tools. See above. */
export const NEVER_A_TOOL: readonly string[] = [
  "record.create",
  "record.update",
  "record.delete",
];

export const writeTools: ToolSpec[] = [
  ...WRITE_SPECS.map(buildWriteTool),
  ...extraWriteTools,
  // Turn 2. Not one of the 56 — it submits whichever of them was prepared.
  approveProposal,
  // And the one that throws a proposal away when they say no. Without it a
  // refused change stays live and approvable — found by running it for real.
  discardProposal,
];

export { buildWriteTool, type WriteToolSpec } from "./build";
