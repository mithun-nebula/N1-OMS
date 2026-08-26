import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";

/**
 * E7's room half — plan section 2.5.8.
 *
 * `meeting.create` accepted `roomId` and stored it inertly; `roomBookHandler`
 * existed, was registered, and was called by **nothing**. So "in person" meant
 * nothing at all, and neither did "both".
 *
 * These live in their own file rather than in `workplace.test.ts` because they
 * fill rooms up, and a test that books every room for a window does not belong
 * next to tests that assume rooms are free.
 */

function world() {
  return buildDemoWorld();
}

async function fillEveryRoom(
  spine: Awaited<ReturnType<typeof buildDemoWorld>>["spine"],
  from: string,
  to: string,
): Promise<void> {
  for (const roomId of ["hall-1", "hall-2", "small-room"]) {
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "room.book",
        args: { roomId, title: "Taken", from, to },
      }),
    );
  }
}

describe("E7 — the room actually gets booked", () => {
  it("an in-person meeting books a room, and says which one", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-11-02T09:00:00Z",
          to: "2026-11-02T09:30:00Z",
          attendees: ["priya", "arun"],
        },
      }),
    );
    expect(created.status).toBe("ran");
    const { meetingId, bookingId, roomId } = created.result?.response as {
      meetingId: string;
      bookingId?: string;
      roomId?: string;
    };
    expect(bookingId).toBeTruthy();

    // A real `booking` record, written by room.book — not a field on the meeting.
    const booking = (await deps.graph.getNode("booking", bookingId!))?.data as {
      roomId: string;
      from: string;
    };
    expect(booking.roomId).toBe(roomId);
    expect(booking.from).toBe("2026-11-02T09:00:00Z");

    // Kept on the meeting, so cancel can release it.
    expect((await deps.graph.getNode("meeting", meetingId))?.data).toMatchObject({ bookingId });
    // And everyone is told which room, which is half of what E7 asks for.
    expect(deps.bus.forActor("priya").some((n) => n.message.includes("Room: "))).toBe(true);
  });

  it("a both meeting gets a room AND a link", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          kind: "both",
          from: "2026-11-03T15:00:00Z",
          to: "2026-11-03T16:00:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { meetingId, bookingId } = created.result?.response as {
      meetingId: string;
      bookingId?: string;
    };
    const record = (await deps.graph.getNode("meeting", meetingId))?.data as {
      link?: string;
      bookingId?: string;
    };
    expect(record.link).toBeTruthy();
    expect(bookingId).toBeTruthy();
    expect(record.bookingId).toBe(bookingId);
    // Both halves reach the person, in one message.
    const toPriya = deps.bus.forActor("priya").map((n) => n.message).join("\n");
    expect(toPriya).toContain("Join: ");
    expect(toPriya).toContain("Room: ");
  });

  it("counts the ORGANISER in the capacity, not just the attendees", async () => {
    const { spine } = await world();
    // Small Room holds 8. Eight attendees plus James is nine people in the
    // room — and with the plan's literal `attendees.length` this would have
    // been accepted at exactly 8, which is the very bug the capacity check
    // exists to stop.
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "All hands",
          kind: "in-person",
          roomId: "small-room",
          from: "2026-11-04T10:00:00Z",
          to: "2026-11-04T11:00:00Z",
          attendees: ["priya", "arun", "karthik", "shruti", "ravi", "meena", "vikram", "divya"],
        },
      }),
    );
    expect(created.status).toBe("ran");
    const response = created.result?.response as {
      meetingId: string;
      bookingId?: string;
      roomReason?: string;
    };
    expect(response.bookingId).toBeUndefined();
    expect(response.roomReason).toMatch(/too small/i);
    // The meeting exists regardless.
    expect(response.meetingId).toBeTruthy();
  });

  it("still creates the meeting when no room is available, with the reason in its message", async () => {
    const { spine, deps } = await world();
    await fillEveryRoom(spine, "2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z");
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Squeezed in",
          kind: "in-person",
          from: "2026-11-05T10:00:00Z",
          to: "2026-11-05T10:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    // ⚠ THE TRAP. A meeting must not be lost for want of a room.
    expect(created.status).toBe("ran");
    const response = created.result?.response as { meetingId: string; bookingId?: string };
    expect(response.meetingId).toBeTruthy();
    expect(response.bookingId).toBeUndefined();
    // The organiser needs to know, so it travels in the message rather than
    // only in the response.
    expect(
      deps.bus.forActor("priya").some((n) => n.message.includes("No room was booked")),
    ).toBe(true);
  });

  it("a both meeting with no room still has its link — that is not a failure", async () => {
    const { spine, deps } = await world();
    await fillEveryRoom(spine, "2026-11-06T10:00:00Z", "2026-11-06T11:00:00Z");
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Still fine",
          kind: "both",
          from: "2026-11-06T10:00:00Z",
          to: "2026-11-06T10:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    expect(created.status).toBe("ran");
    const record = (await deps.graph.getNode(
      "meeting",
      (created.result?.response as { meetingId: string }).meetingId,
    ))?.data as { link?: string; bookingId?: string };
    // A MISSING LINK refuses the meeting (plan section 2.5.5). A missing room
    // must NOT be treated the same way — this meeting works.
    expect(record.link).toBeTruthy();
    expect(record.bookingId).toBeUndefined();
  });

  it("cancelling the meeting releases the room", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-11-07T09:00:00Z",
          to: "2026-11-07T09:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { meetingId, bookingId } = created.result?.response as {
      meetingId: string;
      bookingId: string;
    };
    expect(await deps.graph.getNode("booking", bookingId)).toBeTruthy();

    await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.cancel", args: { meetingId } }),
    );
    // A cancelled meeting still holding its room blocks it for a meeting
    // nobody can see.
    expect(await deps.graph.getNode("booking", bookingId)).toBeUndefined();
  });

  it("moving the meeting moves the room booking with it", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-11-08T09:00:00Z",
          to: "2026-11-08T09:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { meetingId, bookingId } = created.result?.response as {
      meetingId: string;
      bookingId: string;
    };
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.update",
        args: { meetingId, from: "2026-11-08T14:00:00Z", to: "2026-11-08T14:30:00Z" },
      }),
    );
    const after = (await deps.graph.getNode("meeting", meetingId))?.data as { bookingId?: string };
    expect(after.bookingId).toBeTruthy();
    // The old booking is gone: a room held at 09:00 for a meeting at 14:00 is a
    // room blocked for nobody.
    expect(await deps.graph.getNode("booking", bookingId)).toBeUndefined();
    const moved = (await deps.graph.getNode("booking", after.bookingId!))?.data as { from: string };
    expect(moved.from).toBe("2026-11-08T14:00:00Z");
  });

  it("undoing the creation gives the room back", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-11-09T09:00:00Z",
          to: "2026-11-09T09:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { bookingId } = created.result?.response as { bookingId: string };
    const undone = await spine.undo(created.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    // An undo that leaves a room blocked is worse than no undo — the room stays
    // blocked for a meeting nobody can see.
    expect(await deps.graph.getNode("booking", bookingId)).toBeUndefined();
  });
});
