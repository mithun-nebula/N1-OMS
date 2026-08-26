import type { RecordStore } from "@/spine/record/types";

/**
 * A hundred-row fixture, so the cap can be exercised by a real question.
 *
 * 1a's learning log, item 5: `truncated` had **never fired against a real
 * question**. No answer in its twelve reached the cap of twenty, so the only
 * exercise the flag ever had was a unit test with a 25-row seed — and a unit
 * test proves `shape()` sets the flag, which was never in doubt.
 *
 * What was in doubt is whether the *model* reads it. The failure mode is
 * specific and quiet: the model says "you have 20 tasks" when there are a
 * hundred, in exactly the confident voice it uses for a true answer. Nobody
 * checking the answer would catch it, because 20 rows are genuinely there.
 *
 * So: a hundred rows, and a question that spans them.
 */

/** Comfortably past `DEFAULT_CAP` (20), and past any plausible raising of it. */
export const CAP_FIXTURE_ROWS = 100;

/**
 * Seed ~100 tasks assigned to one person.
 *
 * Tasks are the cheapest thing to seed in bulk and the most natural thing to
 * ask a spanning question about ("what is on the board?"). Written straight to
 * the graph rather than through `task.create` because this is a fixture, not a
 * behaviour under test — and going through the gate would cost 100 operations
 * and an activity entry each.
 *
 * A consequence worth knowing, and it is the gate working rather than a
 * shortcoming: records written this way never enter the `owners` map, so a
 * manager's `own-team` scope cannot claim them. Ask as HR or an admin, who see
 * the whole board, or the cap will not be reached for a reason that has nothing
 * to do with capping.
 */
export async function seedManyTasks(
  graph: RecordStore,
  opts: { assignedTo?: string; count?: number; prefix?: string } = {},
): Promise<string[]> {
  const { assignedTo = "priya", count = CAP_FIXTURE_ROWS, prefix = "capfix" } = opts;
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `${prefix}_${String(i).padStart(3, "0")}`;
    await graph.putNode("task", id, {
      title: `Bulk task ${i}`,
      assignedTo,
      status: i % 3 === 0 ? "done" : "todo",
      priority: "medium",
      createdBy: "james",
    });
    ids.push(id);
  }
  return ids;
}
