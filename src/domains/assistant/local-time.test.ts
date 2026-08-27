import { describe, it, expect } from "vitest";
import { utcOffset } from "./day-plan/time";
import { assistantSystemPrompt } from "./agent";
import { workplaceWriteTools } from "./tools/write/workplace";

/**
 * A clock time a person speaks is a LOCAL time.
 *
 * `time.ts` already records this being fixed once, for the calendar: stamping
 * `Z` on "14:00" claimed two o'clock UTC, which is half past seven in the
 * evening here. The lesson did not reach `meeting.create`, whose tool
 * description said "ISO timestamp" and stopped there — so asked for a meeting
 * "today at 2 pm" the model wrote `...T14:00:00Z` and was five and a half
 * hours wrong while looking entirely correct.
 *
 * Nothing here can prove what a model will write. What it can prove is that
 * the model is TOLD — which is the plan's own rule about anything computed
 * rather than retrieved.
 */

describe("the offset the organisation runs at", () => {
  it("is written the way an ISO timestamp wants it", () => {
    expect(utcOffset()).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it("reports India as +05:30, not -05:30", () => {
    // getTimezoneOffset returns minutes BEHIND UTC, so IST is -330 and the
    // sign has to be flipped. Getting that backwards is silent and doubles the
    // error rather than removing it.
    const ist = { getTimezoneOffset: () => -330 } as Date;
    expect(utcOffset(ist)).toBe("+05:30");
  });

  it("keeps a half-hour offset, rather than rounding to hours", () => {
    const nepal = { getTimezoneOffset: () => -345 } as Date;
    expect(utcOffset(nepal)).toBe("+05:45");
  });

  it("handles a negative offset", () => {
    const newYork = { getTimezoneOffset: () => 300 } as Date;
    expect(utcOffset(newYork)).toBe("-05:00");
  });
});

describe("the system prompt states the timezone, not only the date", () => {
  const prompt = assistantSystemPrompt("2026-08-27", "+05:30");

  it("still states today", () => {
    expect(prompt).toContain("2026-08-27");
  });

  it("names the offset the organisation runs at", () => {
    expect(prompt).toContain("+05:30");
  });

  it("says a spoken clock time is local, with a worked example", () => {
    expect(prompt).toMatch(/14:00\+05:30/);
    expect(prompt).toMatch(/never 14:00Z/i);
  });

  it("carries the offset through, whatever it is", () => {
    expect(assistantSystemPrompt("2026-08-27", "-05:00")).toContain("-05:00");
  });
});

describe("create_meeting asks for a local timestamp and no default kind", () => {
  const meeting = workplaceWriteTools.find((t) => t.tool === "create_meeting");

  it("exists", () => {
    expect(meeting).toBeDefined();
  });

  it("tells the model to write the offset, and not a trailing Z", () => {
    // zod keeps `.describe()` text in the field's metadata rather than
    // anywhere JSON.stringify reaches, so read the descriptions directly.
    const shape = meeting!.args.shape as Record<string, { description?: string }>;
    const from = shape.from?.description ?? "";
    expect(from).toMatch(/\+05:30/);
    expect(from).toMatch(/never a trailing Z/i);
  });

  it("no longer calls `both` the default", () => {
    const notes = (meeting!.notes ?? []).join(" ");
    // The old wording — "the default and usually right" — is what made it book
    // a room for a request that only ever asked for a link.
    expect(notes).not.toMatch(/both[^.]*\bdefault\b/i);
    expect(notes).not.toMatch(/usually right/i);
  });

  it("names which words mean online, and which mean in-person", () => {
    const notes = (meeting!.notes ?? []).join(" ").toLowerCase();
    expect(notes).toContain("gmeet");
    expect(notes).toContain("in person");
  });
});
