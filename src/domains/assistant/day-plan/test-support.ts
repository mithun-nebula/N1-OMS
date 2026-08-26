import type { DayPlanService } from "./service";

/**
 * Start a day and work through its brief, the way a person does.
 *
 * A1 is conversation-first and the service enforces it, so a test cannot jump
 * straight from `startDay` to `selectItem` any more than the UI can.
 *
 * This lives in its own module rather than in `assistant.test.ts` because
 * `durability.test.ts` needs it too. Importing it from a `*.test.ts` file made
 * vitest load and register that whole file a second time, so every test in it
 * was counted — and run — twice, and the reported suite total was inflated by
 * about sixty. Not a `*.test.ts` name, so vitest's `include` never collects it.
 */
export async function openDay(
  svc: DayPlanService,
  actor: string,
  date: string,
): Promise<void> {
  await svc.startDay(actor, date);
  // Bounded: the brief is a handful of items, never dozens.
  for (let i = 0; i < 50; i += 1) {
    const plan = svc.getStore().get(actor, date);
    if (!plan || plan.phase !== "briefing") return;
    svc.answerBrief(actor, date, "Got it");
  }
}
