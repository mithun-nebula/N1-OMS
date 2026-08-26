import { describe, it, expect, beforeEach } from "vitest";
import { resetStubVideo, stubVideoCalls } from "@/config/video-stub";
import { buildDemoWorld } from "@/server/bootstrap";
import { getQuestionLimiter } from "@/server/limiter";
import * as adapters from "@/spine/adapters";
import { monthView } from "./calendar";
import { repeatFaults } from "./equipment";
import { findExpiringDocuments, requiredVsSupplied } from "./documents";
import { findOverdueEventTasks, registrationPacing } from "./events";

function world() {
  return buildDemoWorld();
}

describe("room.booking — clash is resolved, not refused", () => {
  it("proposes alternatives when a room clashes", async () => {
    const { spine } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "room.book",
        args: { roomId: "hall-1", title: "Review", from: "2026-08-10T14:00:00Z", to: "2026-08-10T15:00:00Z" },
      }),
    );
    const clash = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "room.book",
        args: { roomId: "hall-1", title: "Sync", from: "2026-08-10T14:30:00Z", to: "2026-08-10T15:30:00Z" },
      }),
    );
    expect(clash.status).toBe("ran");
    expect(clash.result?.response).toMatchObject({ resolved: false });
    expect((clash.result?.response as { alternatives: string[] }).alternatives.length).toBeGreaterThan(0);
  });

  it("displaces the existing booking when asked", async () => {
    const { spine } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "room.book",
        args: { roomId: "hall-1", title: "Review", from: "2026-08-10T14:00:00Z", to: "2026-08-10T15:00:00Z" },
      }),
    );
    const res = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "room.book",
        args: { roomId: "hall-1", title: "Sync", from: "2026-08-10T14:30:00Z", to: "2026-08-10T15:30:00Z", displaceClash: true },
      }),
    );
    expect(res.result?.response).toMatchObject({ resolved: true });
    expect((res.result?.response as { displaced: string }).displaced).toBeTruthy();
  });
});

describe("meetings — immutable link + late-add auto-send", () => {
  it("creates a link that survives a move and reaches a late attendee", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-08-10T15:00:00Z",
          to: "2026-08-10T16:00:00Z",
          attendees: ["priya", "arun"],
        },
      }),
    );
    expect(created.status).toBe("ran");
    const meetingId = (created.result?.response as { meetingId: string }).meetingId;
    const link = ((await deps.graph.getNode("meeting", meetingId))?.data as { link?: string }).link;
    expect(link).toBeTruthy();

    const moved = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.update",
        args: { meetingId, title: "Course review (moved)", from: "2026-08-10T16:00:00Z", to: "2026-08-10T17:00:00Z" },
      }),
    );
    expect(moved.status).toBe("ran");
    expect(((await deps.graph.getNode("meeting", meetingId))?.data as { link?: string }).link).toBe(link);

    const added = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.addAttendee",
        args: { meetingId, attendee: "karthik" },
      }),
    );
    expect((added.result?.response as { sentLinkTo: string }).sentLinkTo).toBe("karthik");
  });
});

describe("meeting decisions — record + complete action", () => {
  it("records decisions and actions, then marks an action done", async () => {
    const { spine, deps } = await world();
    const recorded = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.recordDecisions",
        args: {
          meetingId: "m1",
          decisions: [{ text: "Ship v2 next sprint" }],
          actions: [{ text: "Write migration notes", owner: "priya", due: "2026-08-25" }],
        },
      }),
    );
    expect(recorded.status).toBe("ran");
    expect(recorded.result?.response).toMatchObject({ decisionCount: 1, actionCount: 1 });

    const node = await deps.graph.getNode("meeting-decision", "decisions:m1");
    const actions = (node?.data as { actions: Array<{ id: string; done?: boolean }> }).actions;
    expect(actions).toHaveLength(1);
    expect(actions[0].done).toBeUndefined();

    const done = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "meeting.completeAction",
        args: { meetingId: "m1", actionId: actions[0].id },
      }),
    );
    expect(done.status).toBe("ran");
    const after = await deps.graph.getNode("meeting-decision", "decisions:m1");
    expect(
      (after?.data as { actions: Array<{ done?: boolean; completedAt?: string }> }).actions[0],
    ).toMatchObject({ done: true });
  });

  it("appends to an existing set instead of overwriting it", async () => {
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.recordDecisions",
        args: { meetingId: "m1", decisions: [{ text: "First" }] },
      }),
    );
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.recordDecisions",
        args: { meetingId: "m1", decisions: [{ text: "Second" }] },
      }),
    );
    const node = await deps.graph.getNode("meeting-decision", "decisions:m1");
    const texts = (node?.data as { decisions: Array<{ text: string }> }).decisions.map((d) => d.text);
    expect(texts).toEqual(["First", "Second"]);
  });

  it("refuses an intern recording decisions (view-only reach)", async () => {
    // The workplaceRules() reach for `meeting-decision`: everyone views,
    // everyone but interns writes — the /decisions page relies on the view
    // half, this proves the write half stays closed.
    const { spine } = await world();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "meeting.recordDecisions",
        args: { meetingId: "m1", decisions: [{ text: "Interns decide policy" }] },
      }),
    );
    expect(attack.status).toBe("forbidden");
  });
});

describe("common calendar — notify + record + undo are atomic", () => {
  it("every calendar op returns notify + undo (and is recorded)", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "calendar.create",
        args: { title: "Sprint review", kind: "meeting", date: "2026-08-12", from: "2026-08-12T10:00:00Z", to: "2026-08-12T11:00:00Z", people: "course team" },
      }),
    );
    expect(created.status).toBe("ran");
    const entryId = (created.result?.response as { entryId: string }).entryId;
    expect((created.result?.response as { picks: string[] }).picks.length).toBeGreaterThan(0);
    expect(created.result?.publishedTo?.length).toBeGreaterThan(0);
    expect(created.result?.undo).toBeTruthy();
    expect((await deps.log.query({ operationName: "calendar.create" })).length).toBe(1);

    const edited = await spine.submit(
      adapters.fromForm({ actor: "arun", name: "calendar.edit", args: { entryId, title: "Sprint review (edited)" } }),
    );
    expect(edited.result?.publishedTo?.length).toBeGreaterThan(0);
    expect(edited.result?.undo).toBeTruthy();

    const added = await spine.submit(
      adapters.fromForm({ actor: "arun", name: "calendar.addPeople", args: { entryId, people: "ops team" } }),
    );
    expect(added.result?.undo).toBeTruthy();

    const removed = await spine.submit(
      adapters.fromForm({ actor: "arun", name: "calendar.removePeople", args: { entryId, people: ["priya"] } }),
    );
    expect((removed.result?.response as { removedBy: string }).removedBy).toBe("arun");
    expect(removed.result?.undo).toBeTruthy();

    const cancelled = await spine.submit(
      adapters.fromForm({ actor: "arun", name: "calendar.cancel", args: { entryId } }),
    );
    expect(cancelled.result?.undo).toBeTruthy();
  });

  it("undo is offered to anyone (not just the creator)", async () => {
    const { spine } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "calendar.create", args: { title: "x", kind: "meeting", date: "2026-08-13" } }),
    );
    const entry = created.activityEntry!.id;
    const undone = await spine.undo(entry, "ravi");
    expect(undone.status).toBe("undone");
  });

  it("renders a month-only density view", async () => {
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "calendar.create", args: { title: "Quick sync", kind: "meeting", date: "2026-08-15" } }),
    );
    const cells = await monthView(deps.graph, 2026, 8);
    expect(cells.length).toBe(31);
    expect(cells[14].meetings).toBe(1);
    expect(cells[17].events.find((e) => e.title === "SHOWCASE")).toBeTruthy();
  });
});

describe("equipment — repeat-fault detection", () => {
  it("counts three faults on the same equipment in a month", async () => {
    const { spine, deps } = await world();
    for (let i = 0; i < 3; i++) {
      await spine.submit(
        adapters.fromVoice({
          actor: "arun",
          name: "equipment.reportFault",
          args: { equipmentId: "projector-hall-1", fault: "flickering" },
          transcript: "the projector in hall 1 isn't working",
        }),
      );
    }
    expect((await repeatFaults(deps.graph, "projector-hall-1", "2026-08")).length).toBe(3);
  });
});

describe("utilities — the shared question allowance", () => {
  it("allows exactly the allowance, then refuses", async () => {
    const { spine } = await world();
    // Pinned to two, which is what this test was written against. The default
    // became six in Phase 2, and the property here is "utility.capture spends
    // the SHARED allowance and stops when it runs out" — not what the number
    // happens to be. Pinning keeps the assertions below exactly as they were.
    getQuestionLimiter().setCapFor("arun", 2);
    const a = await spine.submit(adapters.fromForm({ actor: "arun", name: "utility.capture", args: { subject: "Hall 1 AC", detail: "on 9-6" } }));
    const b = await spine.submit(adapters.fromForm({ actor: "arun", name: "utility.capture", args: { subject: "Hall 2 AC", detail: "on 9-6" } }));
    const c = await spine.submit(adapters.fromForm({ actor: "arun", name: "utility.capture", args: { subject: "Small Room AC", detail: "on 9-6" } }));
    expect((a.result?.response as { captured: boolean }).captured).toBe(true);
    expect((b.result?.response as { captured: boolean }).captured).toBe(true);
    expect((c.result?.response as { captured: boolean }).captured).toBe(false);
  });
});

describe("documents — required-vs-supplied + expiry", () => {
  it("tracks a required doc and flags expiry", async () => {
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({ actor: "shruti", name: "document.require", args: { nodeType: "course", nodeId: "ai-basics", name: "Insurance certificate" } }),
    );
    expect((await requiredVsSupplied(deps.graph, "course", "ai-basics")).missing).toContain("Insurance certificate");
    await spine.submit(
      adapters.fromForm({ actor: "shruti", name: "document.store", args: { name: "Insurance certificate", nodeType: "course", nodeId: "ai-basics", expiresOn: "2026-09-02" } }),
    );
    expect((await requiredVsSupplied(deps.graph, "course", "ai-basics")).missing).not.toContain("Insurance certificate");
    const expiring = await findExpiringDocuments(deps.graph, "2026-08-08", 30);
    expect(expiring.find((d) => d.name === "Insurance certificate")).toBeTruthy();
  });
});

describe("events — registration pacing + overdue tasks", () => {
  it("registers attendees and paces against a target", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "event.create", args: { title: "Demo Day", date: "2026-09-20", capacity: 100 } }),
    );
    const eventId = (created.result?.response as { eventId: string }).eventId;
    await spine.submit(adapters.fromForm({ actor: "james", name: "event.register", args: { eventId, attendee: "priya" } }));
    expect(await registrationPacing(deps.graph, eventId, 10)).toBe("behind");
    for (const a of ["arun", "karthik", "divya", "meena", "ravi", "naveen", "shruti"]) {
      await spine.submit(adapters.fromForm({ actor: "james", name: "event.register", args: { eventId, attendee: a } }));
    }
    expect(await registrationPacing(deps.graph, eventId, 5)).toBe("ahead");

    await spine.submit(
      adapters.fromForm({ actor: "james", name: "event.addTask", args: { eventId, text: "Book caterer", owner: "shruti", due: "2020-01-01" } }),
    );
    expect((await findOverdueEventTasks(deps.graph, "2026-08-08")).length).toBeGreaterThan(0);
  });
});

describe("notify.send — a line in the bell, no record written", () => {
  it("delivers to each recipient and touches no graph records", async () => {
    const { spine, deps } = await world();
    const before = (await deps.graph.find("notification", () => true)).length;
    const sent = await spine.submit(
      adapters.fromForm({ actor: "james", name: "notify.send", args: { message: "New policy", to: ["priya", "arun"] } }),
    );
    expect(sent.status).toBe("ran");
    expect((sent.result?.response as { sentTo: number }).sentTo).toBe(2);
    expect(deps.bus.forActor("priya").some((n) => n.message.includes("New policy"))).toBe(true);
    expect(deps.bus.forActor("arun").some((n) => n.message.includes("New policy"))).toBe(true);
    expect((await deps.graph.find("notification", () => true)).length).toBe(before);
  });

  it("refuses an empty recipient list", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({ actor: "james", name: "notify.send", args: { message: "to nobody", to: [] } }),
    );
    expect(res.status).toBe("rejected");
  });
});

describe("E5 — every change names what it was and who did it", () => {
  it("a calendar edit tells everyone what moved, and who moved it", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "calendar.create",
        args: {
          title: "Sprint review",
          kind: "meeting",
          date: "2026-08-12",
          from: "2026-08-12T10:00:00Z",
          to: "2026-08-12T11:00:00Z",
          people: ["priya", "arun"],
        },
      }),
    );
    const entryId = (created.result?.response as { entryId: string }).entryId;

    await spine.submit(
      adapters.fromForm({
        actor: "arun",
        name: "calendar.edit",
        args: { entryId, date: "2026-08-14" },
      }),
    );

    const toPriya = deps.bus.forActor("priya").map((n) => n.message);
    const edit = toPriya.find((m) => m.includes("moved"));
    expect(edit).toBeTruthy();
    // Both halves of E5, in one sentence: WHO did it...
    expect(edit).toContain("Arun");
    // ...and WHAT changed — the old day and the new one, not just "changed".
    expect(edit).toContain("Sprint review");
    expect(edit).toContain("Wednesday 12 August");
    expect(edit).toContain("Friday 14 August");
  });

  it("no meeting or calendar notification falls back to '<type>:<id> changed'", async () => {
    const { spine, deps } = await world();

    // All nine operations, in one run.
    const madeEntry = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "calendar.create",
        args: { title: "Open day", kind: "event", date: "2026-08-20", people: ["priya", "arun"] },
      }),
    );
    const entryId = (madeEntry.result?.response as { entryId: string }).entryId;
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "calendar.edit", args: { entryId, title: "Open day (final)" } }),
    );
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "calendar.addPeople", args: { entryId, people: ["karthik"] } }),
    );
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "calendar.removePeople", args: { entryId, people: ["priya"] } }),
    );
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "calendar.cancel", args: { entryId } }),
    );

    const madeMeeting = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-09-10T15:00:00Z",
          to: "2026-09-10T16:00:00Z",
          attendees: ["priya", "arun"],
        },
      }),
    );
    const meetingId = (madeMeeting.result?.response as { meetingId: string }).meetingId;
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.update",
        args: { meetingId, from: "2026-09-10T17:00:00Z", to: "2026-09-10T18:00:00Z" },
      }),
    );
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.addAttendee", args: { meetingId, attendee: "karthik" } }),
    );
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.cancel", args: { meetingId } }),
    );

    // `summarizeChanges` is the fallback the spine uses when an operation
    // supplies no message. If any of the nine still relies on it, one of these
    // strings shows up in the bell.
    const everything = deps.bus.published().map((n) => n.message);
    const fallbacks = everything.filter((m) => /^(meeting|calendar-entry):\S+ changed/.test(m));
    expect(fallbacks).toEqual([]);

    // And every one of them named a person, which the fallback never does.
    for (const actor of ["priya", "arun", "karthik"]) {
      for (const message of deps.bus.forActor(actor)) {
        expect(message.message).toMatch(/^(James|Arun|Priya|Karthik)\b/);
      }
    }
  });
});

describe("E7 — the link reaches the people, not the caller", () => {
  it("puts the link in every attendee's notification on create", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-09-10T15:00:00Z",
          to: "2026-09-10T16:00:00Z",
          attendees: ["priya", "arun"],
        },
      }),
    );
    const meetingId = (created.result?.response as { meetingId: string }).meetingId;
    const link = ((await deps.graph.getNode("meeting", meetingId))?.data as { link?: string }).link!;
    expect(link).toBeTruthy();

    // The BUS, not the response. The response was only ever visible to whoever
    // made the call — which is precisely the defect E7's ★ rule describes.
    for (const attendee of ["priya", "arun"]) {
      const messages = deps.bus.forActor(attendee).map((n) => n.message);
      expect(messages.some((m) => m.includes(link))).toBe(true);
    }
  });

  it("sends the link to a late-added attendee automatically", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "both",
          from: "2026-09-11T15:00:00Z",
          to: "2026-09-11T16:00:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const meetingId = (created.result?.response as { meetingId: string }).meetingId;
    const link = ((await deps.graph.getNode("meeting", meetingId))?.data as { link?: string }).link!;

    expect(deps.bus.forActor("karthik").length).toBe(0);
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.addAttendee", args: { meetingId, attendee: "karthik" } }),
    );
    const toKarthik = deps.bus.forActor("karthik").map((n) => n.message);
    expect(toKarthik.some((m) => m.includes(link))).toBe(true);
    // Named, and named by whom — nobody pasted anything.
    expect(toKarthik.some((m) => m.startsWith("James") && m.includes("Course review"))).toBe(true);
  });

  it("leaves no dangling link text on an in-person meeting", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-09-12T09:00:00Z",
          to: "2026-09-12T09:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    expect(created.status).toBe("ran");
    const meetingId = (created.result?.response as { meetingId: string }).meetingId;
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.addAttendee", args: { meetingId, attendee: "karthik" } }),
    );

    // No link, and therefore no "Join:" trailing a blank — a message ending in
    // an empty URL reads as a bug to the person who receives it.
    for (const actor of ["priya", "karthik"]) {
      for (const n of deps.bus.forActor(actor)) {
        expect(n.message).not.toContain("Join:");
        expect(n.message.trim()).toBe(n.message);
      }
    }
  });
});

describe("E7 — cancelling actually ends the link", () => {
  beforeEach(() => resetStubVideo());

  it("cancels with the PROVIDER's id, not the local one, and clears the link", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-09-13T15:00:00Z",
          to: "2026-09-13T16:00:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const meetingId = (created.result?.response as { meetingId: string }).meetingId;
    const record = (await deps.graph.getNode("meeting", meetingId))?.data as {
      link?: string;
      linkId: string;
      providerMeetingId?: string;
    };
    // The provider's own id is kept, in its own field, distinct from `linkId`.
    expect(record.providerMeetingId).toBeTruthy();
    expect(record.providerMeetingId).not.toBe(record.linkId);

    const cancelled = await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.cancel", args: { meetingId } }),
    );
    expect(cancelled.status).toBe("ran");

    // What the provider was actually handed. Passing `linkId` — which is what
    // happened before this phase — fails right here.
    const cancels = stubVideoCalls().filter((c) => c.op === "cancel");
    expect(cancels).toHaveLength(1);
    expect(cancels[0].arg).toBe(record.providerMeetingId);
    expect(cancels[0].arg).not.toBe(record.linkId);

    // And `linkEnded` is a fact rather than a claim: the link is gone from the
    // record because the provider confirmed it.
    const after = (await deps.graph.getNode("meeting", meetingId))?.data as {
      link?: string;
      cancelled?: boolean;
    };
    expect(after.cancelled).toBe(true);
    expect(after.link).toBeUndefined();
    expect(cancelled.result?.changes[0].after).toMatchObject({ linkEnded: true });
  });

  it("does not claim linkEnded when the provider refuses", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-09-14T15:00:00Z",
          to: "2026-09-14T16:00:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const meetingId = (created.result?.response as { meetingId: string }).meetingId;
    const link = ((await deps.graph.getNode("meeting", meetingId))?.data as { link?: string }).link;

    // Strip the handle the way a record written before this phase would look.
    const stale = (await deps.graph.getNode("meeting", meetingId))?.data as Record<string, unknown>;
    delete stale.providerMeetingId;
    await deps.graph.putNode("meeting", meetingId, stale);

    const cancelled = await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.cancel", args: { meetingId } }),
    );
    expect(cancelled.status).toBe("ran");
    expect(cancelled.result?.changes[0].after).toMatchObject({ linkEnded: false });
    // The link stays on the record, because it is still live and hiding that
    // would remove the only evidence.
    expect(((await deps.graph.getNode("meeting", meetingId))?.data as { link?: string }).link).toBe(link);
    // And the people affected are told, rather than the failure being swallowed.
    expect(deps.bus.forActor("priya").some((n) => n.message.includes("could not be ended"))).toBe(true);
  });

  it("says nothing about a link when there was never one", async () => {
    const { spine } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-09-15T09:00:00Z",
          to: "2026-09-15T09:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const meetingId = (created.result?.response as { meetingId: string }).meetingId;
    const cancelled = await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.cancel", args: { meetingId } }),
    );
    expect((cancelled.result?.changes[0].after as { linkEnded?: boolean }).linkEnded).toBeUndefined();
    expect(stubVideoCalls().filter((c) => c.op === "cancel")).toHaveLength(0);
  });
});

describe("meetings appear on the common calendar", () => {
  it("creates a calendar entry AND an edge, and monthView shows it with the link", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-10-08T15:00:00Z",
          to: "2026-10-08T16:00:00Z",
          attendees: ["priya", "arun"],
        },
      }),
    );
    const { meetingId, entryId } = created.result?.response as {
      meetingId: string;
      entryId: string;
    };
    const link = ((await deps.graph.getNode("meeting", meetingId))?.data as { link?: string }).link;

    // An EDGE, not a merge. `calendar-entry.kind === "meeting"` was only ever a
    // label; this is a reference.
    const edges = await deps.graph.edgesOf(meetingId, "out");
    expect(edges.some((e) => e.to === entryId && e.type === "shown-on")).toBe(true);

    const cells = await monthView(deps.graph, 2026, 10);
    const day = cells.find((c) => c.date === "2026-10-08")!;
    expect(day.meetings).toBe(1);
    const shown = day.meetingEntries.find((m) => m.id === entryId);
    expect(shown?.title).toBe("Course review");
    // E7's second place: the link is on the calendar entry.
    expect(shown?.link).toBe(link);
  });

  it("moving the meeting moves the calendar entry with it", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-10-09T15:00:00Z",
          to: "2026-10-09T16:00:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { meetingId, entryId } = created.result?.response as { meetingId: string; entryId: string };
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.update",
        args: { meetingId, from: "2026-10-12T15:00:00Z", to: "2026-10-12T16:00:00Z" },
      }),
    );
    const entry = (await deps.graph.getNode("calendar-entry", entryId))?.data as {
      date: string;
      from: string;
    };
    // An entry left on the old day is worse than no entry: people plan around it.
    expect(entry.date).toBe("2026-10-12");
    expect(entry.from).toBe("2026-10-12T15:00:00Z");
  });

  it("cancelling the meeting removes it from BOTH places", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-10-14T15:00:00Z",
          to: "2026-10-14T16:00:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { meetingId, entryId } = created.result?.response as { meetingId: string; entryId: string };
    expect((await monthView(deps.graph, 2026, 10)).find((c) => c.date === "2026-10-14")!.meetings).toBe(1);

    await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.cancel", args: { meetingId } }),
    );
    expect((await deps.graph.getNode("meeting", meetingId))?.data).toMatchObject({ cancelled: true });
    expect((await deps.graph.getNode("calendar-entry", entryId))?.data).toMatchObject({ cancelled: true });
    expect((await monthView(deps.graph, 2026, 10)).find((c) => c.date === "2026-10-14")!.meetings).toBe(0);
  });

  it("an in-person meeting is on the calendar with no link at all", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-10-15T09:00:00Z",
          to: "2026-10-15T09:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { entryId } = created.result?.response as { entryId: string };
    const shown = (await monthView(deps.graph, 2026, 10))
      .find((c) => c.date === "2026-10-15")!
      .meetingEntries.find((m) => m.id === entryId);
    expect(shown).toBeTruthy();
    expect(shown?.link).toBeUndefined();
  });

  it("undoing the creation takes the calendar entry and the edge with it", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "online",
          from: "2026-10-16T15:00:00Z",
          to: "2026-10-16T16:00:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { meetingId, entryId } = created.result?.response as { meetingId: string; entryId: string };
    const undone = await spine.undo(created.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    expect(await deps.graph.getNode("meeting", meetingId)).toBeUndefined();
    expect(await deps.graph.getNode("calendar-entry", entryId)).toBeUndefined();
    expect(await deps.graph.edgesOf(meetingId, "out")).toEqual([]);
  });
});
