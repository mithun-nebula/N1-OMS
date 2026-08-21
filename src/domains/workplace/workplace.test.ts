import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
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

describe("utilities — two-questions-per-day limit", () => {
  it("allows two captures then refuses the third", async () => {
    const { spine } = await world();
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
