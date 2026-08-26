import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { CourseService } from "@/domains/course/service";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import type { ToolDeps } from "@/domains/assistant/tools";
import { resetTokenBudget } from "@/domains/assistant/token-budget";
import {
  resetConfirmations,
  setConfirmationClock,
  CONFIRMATION_TTL_MS,
} from "@/domains/assistant/tools/confirmation";
import { resetProposals } from "@/domains/assistant/tools/propose";
import type { AuthUser } from "@/server/auth";
import { ScriptedLiveEndpoint } from "./live-scripted";
import { openVoiceSession, type SessionTimers } from "./session";
import type { BrowserSocket } from "./relay";
import type { ServerMessage } from "./protocol";

/**
 * The read-back, spoken — and the seven attacks from Phase 2.5 Part B, now
 * over the voice path.
 *
 * ── ⚠ NO SECOND MECHANISM ───────────────────────────────────────────────────
 *
 * `requireConfirmation` is reused exactly as it is. The token is issued on the
 * first call and spent on the second, precisely as in chat. What changes is
 * only that the sentence is **heard** rather than displayed — which is what
 * that token was always trying to be. A confirmation you have to *read*
 * defeats the point of speaking; one you hear does not.
 *
 * So these tests drive the REAL session and the REAL tools. Nothing here
 * re-implements the gate, and a change to `confirmation.ts` that broke voice
 * would fail here rather than passing a copy.
 *
 * ── ⚠ THE ONE THING THAT DOES NOT TRANSFER, AND WHY IT IS ACCEPTED HERE ─────
 *
 * In chat the turn boundary is a person's typed message. In voice the "second
 * call" arrives because the model decided you said yes — §6.1's problem, one
 * weight lighter. `session.ts` narrows it as far as the server can: a turn
 * advances only on a final `inputTranscription`, which is produced by the
 * recogniser from the person's own audio and cannot be fabricated by the
 * model. It does not close the gap entirely, because a cough transcribes and a
 * cough is not consent.
 *
 * **Why that residue is acceptable for these six verbs and for nothing else:**
 *
 *   - they are reversible — `delete_task` has an undo plan, a cancelled
 *     meeting notifies but can be re-created, a cancelled room booking can be
 *     re-booked;
 *   - they act on things the speaker already controls, not on somebody else's
 *     record;
 *   - the cost of a mistaken yes is an afternoon, not somebody's leave balance
 *     or somebody's pay.
 *
 * Money and people fail all three, which is why they are on the propose tier
 * for voice and cannot be finished by speaking at all. **If any of the three
 * ever stops being true of a verb here, that verb moves to the propose tier
 * for voice** — the argument, not the list, is the thing to check against.
 */

const TODAY = "2026-08-08";
const USER: AuthUser = { id: "james", username: "james", role: "manager", displayName: "James" };

class FakeBrowser implements BrowserSocket {
  readyState = 1;
  readonly text: ServerMessage[] = [];
  private handlers: Record<string, Array<(...a: never[]) => void>> = {};
  send(data: string | Buffer): void {
    if (typeof data === "string") this.text.push(JSON.parse(data) as ServerMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  on(event: string, cb: (...a: never[]) => void): void {
    (this.handlers[event] ??= []).push(cb);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers[event] ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
}

const timers: SessionTimers = { setTimeout: () => 0, clearTimeout: () => {} };

let world: DemoWorld;
let deps: ToolDeps;
let dayPlan: DayPlanService;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  resetConfirmations();
  resetProposals();
  world = await buildDemoWorld();
  dayPlan = new DayPlanService(new DayPlanStore(), {
    graph: world.deps.graph,
    limiter: createQuestionLimiter(),
    actorLookup: () => ({ spine: world.spine }),
  });
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    dayPlan,
    today: () => TODAY,
  };
});

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetConfirmations();
  resetProposals();
  setConfirmationClock(undefined);
});

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A live session, plus the two things a test needs to drive it. */
async function spoken(user: AuthUser = USER) {
  const browser = new FakeBrowser();
  const endpoint = new ScriptedLiveEndpoint();
  const session = await openVoiceSession({ user, browser, endpoint, deps, timers });
  await tick();

  /** The model asks for a tool. Returns what went back up the socket. */
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const before = endpoint.sent.length;
    endpoint.emit({ toolCall: { functionCalls: [{ id: `c${before}`, name, args }] } });
    await tick();
    await tick();
    const sentBack = endpoint.sent
      .slice(before)
      .find((s) => s.kind === "toolResult") as { results: Array<{ response: unknown }> } | undefined;
    const wrapped = sentBack?.results[0]?.response as
      | { untrusted_record_data?: Record<string, unknown> }
      | undefined;
    return (wrapped?.untrusted_record_data ?? wrapped) as Record<string, unknown> | undefined;
  };

  /**
   * A person speaks, which is the ONLY thing that starts a new turn.
   * See `session.ts` — the model saying `turnComplete` does not.
   */
  const personSpeaks = (what: string) => {
    endpoint.emit({ serverContent: { turnComplete: true } });
    endpoint.emit({ serverContent: { inputTranscription: { text: what, finished: true } } });
  };

  return { browser, endpoint, session, callTool, personSpeaks };
}

/** A refusal has to be loud, or it gets narrated as success. */
function expectLoudRefusal(out: Record<string, unknown> | undefined) {
  expect(out?.ok).toBe(false);
  expect(out?.didNotHappen).toBe(true);
  expect(String(out?.tellThem).length).toBeGreaterThan(10);
}

async function anItem(s: Awaited<ReturnType<typeof spoken>>, label = "Module 4") {
  await openDay(dayPlan, USER.id, TODAY);
  const added = await s.callTool("select_item", { label, estimateMinutes: 60 });
  return (added?.added as { id: string }).id;
}

describe("the read-back, heard rather than read", () => {
  it("the first spoken call does NOT act — it comes back with the consequence", async () => {
    const s = await spoken();
    const id = await anItem(s);
    const out = await s.callTool("drop_item", { itemId: id, reason: "not today" });
    expectLoudRefusal(out);
    expect(out?.needsConfirmation).toBe(true);
    expect(typeof out?.consequence).toBe("string");
    // The sentence is what gets spoken aloud, so it has to be one.
    expect(String(out?.consequence).length).toBeGreaterThan(10);
  });

  it("the person answers in a NEW turn, and it acts", async () => {
    const s = await spoken();
    const id = await anItem(s);
    await s.callTool("drop_item", { itemId: id, reason: "not today" });
    s.personSpeaks("yes, drop it");
    const out = await s.callTool("drop_item", { itemId: id, reason: "not today" });
    expect(out?.ok, JSON.stringify(out)).toBe(true);
  });

  it("⚠ the token is the SAME mechanism as chat — no second one exists", async () => {
    // `confirmation.ts` is the only module involved; if voice had grown its own
    // store, resetting the shared one would not disturb it.
    const s = await spoken();
    const id = await anItem(s);
    await s.callTool("drop_item", { itemId: id, reason: "x" });
    resetConfirmations();
    s.personSpeaks("yes");
    const out = await s.callTool("drop_item", { itemId: id, reason: "x" });
    // Nothing pending anywhere, so it asks again rather than acting.
    expectLoudRefusal(out);
  });
});

describe("⚠ the seven attacks, over the voice path", () => {
  it("1 · no token, confirmed anyway — refused", async () => {
    const s = await spoken();
    const id = await anItem(s);
    // The model asserts consent in the payload, the way the old boolean let it.
    const out = await s.callTool("drop_item", { itemId: id, reason: "x", confirmed: true });
    expectLoudRefusal(out);
    expect(out?.needsConfirmation).toBe(true);
  });

  it("2 · a made-up token — refused", async () => {
    const s = await spoken();
    const id = await anItem(s);
    const out = await s.callTool("drop_item", {
      itemId: id,
      reason: "x",
      confirmationToken: "cfm_00000000-0000-0000-0000-000000000000",
    });
    expectLoudRefusal(out);
  });

  it("3 · one actor's token used by another — refused", async () => {
    const mine = await spoken();
    const id = await anItem(mine);
    const issued = await mine.callTool("drop_item", { itemId: id, reason: "x" });
    const token = String(issued?.confirmationToken);
    expect(token).toMatch(/^cfm_/);

    // A different person, speaking on their own socket, presents it.
    const theirs = await spoken({
      id: "priya",
      username: "priya",
      role: "employee",
      displayName: "Priya",
    });
    theirs.personSpeaks("yes");
    const out = await theirs.callTool("drop_item", { itemId: id, reason: "x", confirmationToken: token });
    expectLoudRefusal(out);
  });

  it("4 · a token spent on a different tool — refused", async () => {
    const s = await spoken();
    const id = await anItem(s);
    const issued = await s.callTool("drop_item", { itemId: id, reason: "x" });
    const token = String(issued?.confirmationToken);
    s.personSpeaks("yes");

    // ⚠ The refusal here is STRICTER than in chat, and worth naming rather than
    // quietly passing. `close_out` is the other read-back-gated day-plan verb,
    // and since Phase 4.5 it lives in a specialist — it is not on the
    // coordinator, so it is not in the live set either. The token is not
    // rejected by the confirmation check; there is no tool to present it to.
    const out = await s.callTool("close_out", { confirmationToken: token });
    expect(Object.keys(s.session.toolNames)).not.toContain("close_out");
    expect(out?.ok).not.toBe(true);
    expect(out?.didNotHappen).toBe(true);

    // And the binding still holds where the tool IS reachable: the same token
    // presented to `drop_item` for a different item does nothing. That is the
    // cross-tool property, asserted where voice can actually reach two calls.
    const other = await anItem(s, "Module 5");
    s.personSpeaks("that one too");
    const cross = await s.callTool("drop_item", { itemId: other, reason: "x", confirmationToken: token });
    expectLoudRefusal(cross);
  });

  it("5 · a token spent on a different target — refused", async () => {
    const s = await spoken();
    const a = await anItem(s, "Module 4");
    const b = await anItem(s, "Module 5");
    const issued = await s.callTool("drop_item", { itemId: a, reason: "x" });
    const token = String(issued?.confirmationToken);
    s.personSpeaks("yes");
    const out = await s.callTool("drop_item", { itemId: b, reason: "x", confirmationToken: token });
    expectLoudRefusal(out);
    // And item B is still there.
    const day = await s.callTool("my_day", {});
    expect(JSON.stringify(day)).toContain("Module 5");
  });

  it("6 · an expired token — refused", async () => {
    let now = 1_000_000;
    setConfirmationClock(() => now);
    const s = await spoken();
    const id = await anItem(s);
    const issued = await s.callTool("drop_item", { itemId: id, reason: "x" });
    const token = String(issued?.confirmationToken);

    now += CONFIRMATION_TTL_MS + 1;
    s.personSpeaks("yes");
    const out = await s.callTool("drop_item", { itemId: id, reason: "x", confirmationToken: token });
    // Nothing happened. It re-asks rather than acting on a stale yes.
    expect(out?.ok).not.toBe(true);
    expect(out?.didNotHappen).toBe(true);
  });

  it("7 · the same token twice — refused the second time", async () => {
    const s = await spoken();
    const a = await anItem(s, "Module 4");
    const b = await anItem(s, "Module 5");
    const issued = await s.callTool("drop_item", { itemId: a, reason: "x" });
    const token = String(issued?.confirmationToken);

    s.personSpeaks("yes");
    const first = await s.callTool("drop_item", { itemId: a, reason: "x", confirmationToken: token });
    expect(first?.ok).toBe(true);

    s.personSpeaks("and the other one");
    const second = await s.callTool("drop_item", { itemId: b, reason: "x", confirmationToken: token });
    expectLoudRefusal(second);
  });
});

describe("⚠ the model cannot forge the turn boundary by saying it finished", () => {
  it("chaining two calls with a turnComplete between them does NOT act", async () => {
    const s = await spoken();
    const id = await anItem(s);
    const issued = await s.callTool("drop_item", { itemId: id, reason: "x" });
    const token = String(issued?.confirmationToken);

    // The one frame the model fully controls, and nothing else. Nobody spoke.
    s.endpoint.emit({ serverContent: { turnComplete: true } });

    const out = await s.callTool("drop_item", { itemId: id, reason: "x", confirmationToken: token });
    expectLoudRefusal(out);
    expect(String(out?.tellThem)).toMatch(/same turn/i);
  });

  it("and it does not act on a bare second call either", async () => {
    const s = await spoken();
    const id = await anItem(s);
    await s.callTool("drop_item", { itemId: id, reason: "x" });
    s.endpoint.emit({ serverContent: { turnComplete: true } });
    const out = await s.callTool("drop_item", { itemId: id, reason: "x" });
    expectLoudRefusal(out);
  });

  it("an interim transcription is not a turn either — half a word is not consent", async () => {
    const s = await spoken();
    const id = await anItem(s);
    await s.callTool("drop_item", { itemId: id, reason: "x" });
    s.endpoint.emit({ serverContent: { turnComplete: true } });
    // A cough, a half-word: the recogniser emits something, unfinished.
    s.endpoint.emit({ serverContent: { inputTranscription: { text: "mm", finished: false } } });
    const out = await s.callTool("drop_item", { itemId: id, reason: "x" });
    expectLoudRefusal(out);
  });
});
