import type {
  OperationResult,
  PublishTarget,
  UndoInfo,
  ChangeSummary,
} from "@/spine/operation/registry";

/**
 * The shape every calendar operation returns — and the invariant it must hold.
 *
 * ── Why `assertAtomic` is now called ────────────────────────────────────────
 *
 * It was written, exported, and imported by **nothing**. A guard nothing runs
 * is worse than no guard at all: it reads as protection in review, and protects
 * nothing. The choice was to wire it or delete it, and wiring won for two
 * reasons.
 *
 * It encodes a real invariant rather than a stylistic preference — a calendar
 * change that tells nobody is invisible, and one that cannot be undone is a
 * trap. Every one of the five operations already satisfies it, so it costs
 * nothing today and catches the sixth one, written months from now by somebody
 * who has not read appendix E5.
 *
 * Deleting it would have removed a correct invariant purely because nobody had
 * got round to enforcing it.
 */
export function calendarResult(input: {
  changes: ChangeSummary[];
  notify: PublishTarget[];
  undo: UndoInfo;
  response?: unknown;
}): OperationResult {
  const result: OperationResult = {
    changes: input.changes,
    publishedTo: input.notify,
    undo: input.undo,
    response: input.response,
  };
  // Every calendar result goes through here, so this is the one place the
  // invariant can be enforced without asking anybody to remember it.
  assertAtomic(result);
  return result;
}

/**
 * A calendar change must tell somebody, must say what it was, and must be
 * reversible.
 *
 * The third clause is appendix E5 made mechanical. `PublishTarget.message` is
 * optional in the spine, so an operation that omits it compiles, passes review,
 * and quietly delivers `"calendar-entry:cal_x changed"` — which is exactly what
 * all five of these did until this phase. Optional in the spine, required here.
 *
 * Throws rather than returning a flag: this is a programming error in a new
 * operation, not a runtime condition a caller can handle, and it should fail
 * the test that first exercises the operation rather than reaching a person.
 */
export function assertAtomic(result: OperationResult): void {
  if (!result.publishedTo || result.publishedTo.length === 0) {
    throw new Error("Calendar op missing notify (publishedTo).");
  }
  if (result.publishedTo.some((target) => !target.message)) {
    throw new Error(
      "Calendar op published a target with no message — appendix E5 requires the notification to name what changed and who changed it.",
    );
  }
  if (!result.undo) {
    throw new Error("Calendar op missing undo.");
  }
}
