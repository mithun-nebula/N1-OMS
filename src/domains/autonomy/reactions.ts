import type { ActorId } from "@/spine/operation/types";

/**
 * What leaving the organisation does to the rules somebody left running.
 *
 * `AutonomyEngine.suspendAuthor` was built, tested, and then never called from
 * production. `suspendSeparated()` is reachable only from `tick()` — the
 * admin-only `/api/autonomy/tick` endpoint, or the publish-bus subscription
 * `registerRule` installs. Neither `employee.deactivate` nor
 * `leaving.applySeparation` ever touched autonomy, so separating somebody left
 * their graduated rules **live**, running under their authority and their
 * permissions, until an admin happened to hit the tick endpoint.
 *
 * `CONTEXT.md` §13 #4: "Autonomy is earned (10 clean approvals) and revocable
 * in one tap; *a rule never outlives its owner*." This module is what makes the
 * last clause true.
 *
 * It lives at the route layer, exactly like `assistant/day-plan/reactions.ts`
 * and for the same reason: a side effect must not be able to fail the write it
 * followed. By the time we run, the deactivation has been gated, executed,
 * recorded and published. A rule that fails to suspend is a problem; a
 * separation that half-happened because suspension threw is a worse one.
 *
 * ── Why both routes ───────────────────────────────────────────────────────
 *
 * `employee.deactivate` declares `category: "leaving-org"` and
 * `involvesMoneyOrPeople: () => true`, which makes it look like it always
 * parks. It does not. Every parking condition in `gate.ts` is guarded by
 * `delegated`, so:
 *
 *   - HR deactivating somebody through the form **runs**, and lands at
 *     `/api/operations`.
 *   - A rule-driven deactivation **parks**, and lands at
 *     `/api/operations/[id]/confirm`.
 *
 * Both paths carry real traffic, and hooking either one alone leaves a live
 * hole. `applyAutonomyReactionsFromEntry` is the confirm path's door, because
 * that side has the activity entry and not the original call.
 */

export interface AutonomyReactionDeps {
  engine: {
    suspendAuthor(author: ActorId, reason: string): string[];
  };
}

/** The operations that end somebody's authority, and why. */
const SUSPENDS_RULES: Record<string, string> = {
  "employee.deactivate": "author deactivated",
  "leaving.applySeparation": "author separated",
};

export async function applyAutonomyReactions(
  operationName: string,
  args: Record<string, unknown>,
  deps: AutonomyReactionDeps,
): Promise<void> {
  try {
    const reason = SUSPENDS_RULES[operationName];
    if (!reason) return;
    const employeeId = typeof args.employeeId === "string" ? args.employeeId : "";
    if (!employeeId) return;
    deps.engine.suspendAuthor(employeeId, reason);
  } catch {
    // Never fail the write that triggered us. The operation has already
    // happened and been recorded; this is the tidying that follows it.
  }
}

/**
 * The same reaction, recovered from an activity entry rather than the original
 * call — the confirmation path has the entry but not the arguments.
 *
 * This is the path that actually matters. `employee.deactivate` parks by
 * design, so in production the confirm route is the *only* one that fires.
 *
 * The employee id is recovered from the change whose `nodeType` is
 * `"employee"`, which both operations write.
 */
export async function applyAutonomyReactionsFromEntry(
  entry: {
    operationName: string;
    changes: Array<{ nodeType: string; nodeId: string }>;
  },
  deps: AutonomyReactionDeps,
): Promise<void> {
  if (!SUSPENDS_RULES[entry.operationName]) return;
  for (const change of entry.changes) {
    if (change.nodeType !== "employee") continue;
    await applyAutonomyReactions(
      entry.operationName,
      { employeeId: change.nodeId },
      deps,
    );
  }
}
