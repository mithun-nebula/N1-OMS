import { describe, it, expect } from "vitest";
import { authorRule } from "./author";
import { describeSpec } from "./spec";

/**
 * Turning a sentence into a rule — and refusing when it cannot.
 *
 * ⚠ **Refusing beats guessing.** A rule that fires on the wrong thing runs
 * unattended until somebody notices; a refusal costs one exchange. Every test
 * below is really the same assertion in different clothes.
 */

/** A model that would say yes to anything, to prove nothing depends on it. */
const neverCalled = async (): Promise<string> => {
  throw new Error("the model was called when the offline path should have handled it");
};

describe("a sentence becomes a rule", () => {
  it("maps the ordinary case, and reads it back in plain words", async () => {
    const out = await authorRule(
      "tell me when a course sits in review more than 5 days",
      "james",
      "r1",
      { complete: neverCalled },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.spec.when).toEqual({
      kind: "ageing",
      nodeType: "course",
      state: "review",
      days: 5,
    });
    expect(out.spec.do).toEqual({ opName: "notify.send", to: "author" });
    // ⚠ The read-back must be specific enough to be WRONG in a way somebody
    // would catch. "I'll keep an eye on your courses" is theatre.
    expect(out.readBack).toBe("Tell you when a course sits in review for more than 5 days.");
  });

  it("keeps what they actually said, so the rule can be read rather than re-parsed", async () => {
    const said = "let me know when a certificate is within 30 days of expiring";
    const out = await authorRule(said, "james", "r2", { complete: neverCalled });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.spec.plainLanguage).toBe(said);
    expect(out.spec.when).toEqual({ kind: "expiring", nodeType: "document", withinDays: 30 });
  });

  it("handles a phrasing unlike any example", async () => {
    const out = await authorRule(
      "whenever somebody is carrying more than 10 open tasks, ping me",
      "james",
      "r3",
      { complete: neverCalled },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.spec.when).toMatchObject({ kind: "countOver", count: 10 });
  });

  it("reads a duration written in English, not just in digits", async () => {
    // A live run said this, word for word. There is no digit in it, so the
    // parser gave up, the model was asked, and it answered "I cannot measure
    // that" — for a rule this system expresses exactly. The person was told no
    // for a sentence that was perfectly clear.
    const out = await authorRule(
      "from now on give me a shout if any certificate is creeping up on its renewal date, say within a fortnight",
      "james",
      "r_fortnight",
      { complete: neverCalled },
    );
    expect(out.ok, JSON.stringify(out)).toBe(true);
    if (!out.ok) return;
    expect(out.spec.when).toEqual({ kind: "expiring", nodeType: "document", withinDays: 14 });
  });

  it("reads a week and a month as days", async () => {
    const week = await authorRule("tell me when a course sits in review a week", "james", "r_w", {
      complete: neverCalled,
    });
    expect(week.ok).toBe(true);
    if (week.ok) expect(week.spec.when).toMatchObject({ days: 7 });

    const month = await authorRule(
      "let me know when a certificate is a month from expiring",
      "james",
      "r_m",
      { complete: neverCalled },
    );
    expect(month.ok).toBe(true);
    if (month.ok) expect(month.spec.when).toMatchObject({ withinDays: 30 });
  });

  it('reads "when X, tell me" as a rule and not as a question', async () => {
    // The canonical way somebody writes a rule starts with "when". An earlier
    // version of the parser treated a leading "when" as interrogative and told
    // people their rule looked like a question.
    const out = await authorRule(
      "when a course sits in review more than 5 days, tell me",
      "james",
      "r_when",
      { complete: neverCalled },
    );
    expect(out.ok, JSON.stringify(out)).toBe(true);
  });
});

describe("it refuses rather than approximating", () => {
  it("says it cannot measure a vague sentence, and names what it would need", async () => {
    // The plan's own example, and the one that matters most.
    const out = await authorRule("let me know if things seem to be slipping", "james", "r4", {
      complete: async () =>
        JSON.stringify({
          verdict: "unmeasurable",
          reason: "I can't measure 'slipping'.",
          couldMeasure: "courses in review longer than a set number of days",
        }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("unmeasurable");
    expect(String(out.ask)).toMatch(/did you mean/i);
    expect(String(out.ask)).toMatch(/courses in review/i);
  });

  it("refuses an action outside the DO list, with the reason", async () => {
    const out = await authorRule(
      "when a course sits in review more than 5 days, assign it to Karthik",
      "james",
      "r5",
      { complete: neverCalled },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("unsupported-action");
    expect(out.reason).toMatch(/only notify/i);
  });

  it("refuses REASSIGN, which reading English durations nearly let through", async () => {
    // ⚠ The hole that widening the parser opened. `\bassign\b` does not match
    // inside "reassign" — no word boundary after "re" — so while "a week" was
    // unreadable this fell through to the model, which refused it correctly.
    // The moment the parser could read "a week", this sentence would have been
    // authored offline as a NOTIFICATION: the person asks for work to be moved
    // and instead signs up to be told about it forever.
    //
    // `complete: neverCalled` is the whole point — it proves the refusal is the
    // offline path's own, not the model saving us.
    const out = await authorRule(
      "when a course has been in review a week, reassign it to Karthik",
      "james",
      "r_reassign",
      { complete: neverCalled },
    );
    expect(out.ok, JSON.stringify(out)).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("unsupported-action");
  });

  it("refuses an action on a branch that never had to refuse one before", async () => {
    // The expiring branch had no action guard at all, because it could not read
    // a duration without digits and so rarely got this far.
    const out = await authorRule(
      "cancel the certificate when it is a month from expiring",
      "james",
      "r_cancel",
      { complete: neverCalled },
    );
    expect(out.ok, JSON.stringify(out)).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("unsupported-action");
  });

  it("does not turn a question into a standing rule", async () => {
    // Guess "rule" and somebody has silently signed up for notifications
    // forever. This is the sentence that makes that easy to do.
    const out = await authorRule("which courses are in review over 5 days?", "james", "r6", {
      complete: neverCalled,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("ambiguous");
    expect(String(out.ask)).toMatch(/standing rule, or just the answer/i);
  });

  it("asks when a sentence could be either, and shows what the rule would be", async () => {
    const out = await authorRule("courses in review over 5 days", "james", "r7", {
      complete: neverCalled,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("ambiguous");
    // The ask carries the read-back, so answering "yes, a rule" is answering a
    // specific question rather than a vague one.
    expect(String(out.ask)).toMatch(/sits in review for more than 5 days/);
  });

  it("proceeds once they confirm they meant a standing rule", async () => {
    const out = await authorRule("courses in review over 5 days", "james", "r8", {
      complete: neverCalled,
      confirmedStanding: true,
    });
    expect(out.ok).toBe(true);
  });

  it("refuses a shape the model returns that is not on the closed list", async () => {
    // The model's only job is filling blanks. Anything else is a refusal, not
    // a best effort — because anything a model could invent here is something
    // nobody would ever review.
    const out = await authorRule("watch the thing", "james", "r9", {
      complete: async () =>
        JSON.stringify({
          verdict: "rule",
          when: { kind: "sqlQuery", query: "SELECT * FROM orga_nodes" },
        }),
    });
    expect(out.ok).toBe(false);
  });

  it("refuses when the model returns nothing usable at all", async () => {
    const out = await authorRule("watch the thing", "james", "r10", {
      complete: async () => "I'm not sure what you mean!",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/could not turn that into something I can watch/i);
  });
});

describe("the read-back is specific enough to be caught when wrong", () => {
  it("names the state, the number and who is told", () => {
    const reads = describeSpec({
      id: "x",
      author: "james",
      plainLanguage: "…",
      when: { kind: "ageing", nodeType: "course", state: "draft", days: 12 },
      do: { opName: "notify.send", to: ["priya"] },
      createdAt: "2027-01-01T00:00:00.000Z",
    });
    // If any of these three were missing, a wrong rule would read back
    // plausibly — which is the failure that matters in this phase.
    expect(reads).toContain("draft");
    expect(reads).toContain("12");
    expect(reads).toContain("priya");
  });
});
