import type {
  OperationContext,
  OperationHandler,
  OperationResult,
} from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { providers } from "@/config/providers";
import { nextEntryId, SHOWN_ON_CALENDAR } from "./calendar";
import { roomBookHandler, roomCancelHandler } from "./rooms";
import { localDateOf } from "@/domains/assistant/day-plan/time";
import {
  meetingAttendeeAddedMessage,
  meetingCancelledMessage,
  meetingCreatedMessage,
  meetingUpdatedMessage,
} from "./shared/change-message";

type MeetingKind = "in-person" | "online" | "both";

interface MeetingData {
  title: string;
  kind: MeetingKind;
  from: string;
  to: string;
  roomId?: string;
  /**
   * This application's own id for the link. Local, generated here, and useful
   * only inside this codebase.
   */
  linkId: string;
  link?: string;
  /**
   * **The provider's own id for the meeting** — Google's `event.id`, the stub's
   * `stub-event-N`. Distinct from `linkId` on purpose.
   *
   * `createMeeting` has always returned `{ id, link, kind }` and this code kept
   * only `.link`, throwing the id away. Cancel then passed `linkId` — a
   * `link_meeting_…` string no provider has ever issued — so cancelling a
   * meeting could never have ended its link against anything real. The stub's
   * empty `cancelMeeting` hid it: the call went nowhere and returned cleanly.
   */
  providerMeetingId?: string;
  organizer: string;
  attendees: ActorId[];
  externals: Array<{ email: string }>;
  cancelled?: boolean;
  /**
   * The `calendar-entry` that shows this meeting on the common calendar.
   *
   * `meeting` and `calendar-entry` were unrelated node types with no edge
   * between them, so `/meetings` and `/calendar` showed disjoint worlds and a
   * meeting never appeared on the calendar at all. The edge is the reference;
   * this field is the fast path to it, so cancel and edit can keep the two in
   * step without a traversal on every call.
   */
  calendarEntryId?: string;
  /**
   * The `booking` that holds the room, for an in-person or `both` meeting.
   *
   * `roomId` was accepted and stored inertly; `roomBookHandler` existed, was
   * registered, and was called by **nothing**, so E7's *"a room is booked
   * through feature 25, checked for capacity and equipment"* never happened.
   * Undefined when no suitable room was free — which is not a failure, see
   * `bookRoom` below.
   */
  bookingId?: string;
  [key: string]: unknown;
}

/**
 * The outcome of trying to hold a room, in the two shapes a caller cares about.
 *
 * `room.book` returns `{ resolved: false, reason }` rather than throwing,
 * precisely so this decision sits here. **A meeting must never fail because no
 * room was free** — and a `both` meeting whose room fails still has a working
 * link, so it is not a failure at all.
 */
interface RoomOutcome {
  bookingId?: string;
  roomId?: string;
  name?: string;
  reason?: string;
  /**
   * `displaceClash` moves somebody ELSE's booking to another room. Undoing the
   * meeting has to put that back, or a stranger's booking is left in a room
   * they never chose and nothing records why.
   */
  displaced?: { bookingId: string; roomId: string };
}

/**
 * Book a room for a meeting, reusing `room.book` **entirely**.
 *
 * `roomBookHandler` already does every hard part and is left untouched:
 * picking a suitable free room when none is named (`suitableRooms`, then
 * `findClash`), filtering on capacity and equipment before the clash check,
 * and — with `displaceClash` — moving the clashing booking rather than
 * refusing, which is E7's *"sorts clashes instead of refusing"*.
 *
 * Its `execute` is called directly rather than through the spine: going back
 * through `submit` from inside a handler would re-check permission the meeting
 * has already passed and write a second activity entry for one user action.
 */
async function bookRoom(
  graph: RecordStore,
  ctx: OperationContext,
  input: { roomId?: string; title: string; from: string; to: string; capacity: number },
): Promise<RoomOutcome> {
  const booked = await roomBookHandler(graph).execute(
    { ...input, displaceClash: true },
    ctx,
  );
  const response = booked.response as {
    resolved?: boolean;
    bookingId?: string;
    reason?: string;
    clash?: string;
    alternatives?: string[];
  };
  if (!response?.resolved || !response.bookingId) {
    return {
      reason:
        response?.reason ??
        (response?.clash
          ? "the room was already booked then, and no other suitable room was free."
          : "no suitable room was available."),
    };
  }
  const roomId = (booked.changes[0]?.after as { roomId?: string } | undefined)?.roomId;
  const room = roomId ? ((await graph.getNode("room", roomId))?.data as { name?: string }) : undefined;
  // The displaced booking, and the room it came FROM — `room.book` puts the
  // original on `changes[1].before.roomId` precisely so a caller can reverse it.
  const displacedFrom = (booked.changes[1]?.before as { roomId?: string } | undefined)?.roomId;
  return {
    bookingId: response.bookingId,
    roomId,
    name: room?.name ?? roomId,
    displaced:
      booked.changes[1] && displacedFrom
        ? { bookingId: String(booked.changes[1].nodeId), roomId: displacedFrom }
        : undefined,
  };
}

/**
 * The calendar entry that shows a meeting.
 *
 * Deliberately the same shape a hand-made entry has, so `monthView` and
 * `/calendar` need no special case — plus `link`, which is what E7's "visible
 * on the calendar entry" actually means.
 */
function entryDataFor(meeting: MeetingData, meetingId: string): Record<string, unknown> {
  return {
    title: meeting.title,
    kind: "meeting" as const,
    date: localDateOf(meeting.from),
    from: meeting.from,
    to: meeting.to,
    people: meeting.attendees,
    link: meeting.link,
    // Which meeting this is a projection of. The edge is the reference; this is
    // here so a reader holding only the entry can get back without a traversal.
    meetingId,
    cancelled: meeting.cancelled,
  };
}

let meetingSeq = 0;
function nextMeetingId(): string {
  meetingSeq += 1;
  return `meeting_${Date.now().toString(36)}_${meetingSeq}`;
}

async function readMeeting(graph: RecordStore, id: string): Promise<MeetingData | undefined> {
  const node = await graph.getNode("meeting", id);
  return node?.data as MeetingData | undefined;
}

async function busyAt(graph: RecordStore, actor: string, from: string, to: string): Promise<boolean> {
  const meetings = await graph.find(
    "meeting",
    (n) => (n.data as { cancelled?: boolean }).cancelled !== true,
  );
  return meetings.some((m) => {
    const d = m.data as { attendees?: string[]; from?: string; to?: string };
    return (
      d.attendees?.includes(actor) &&
      d.from &&
      d.to &&
      from < d.to &&
      d.from < to
    );
  });
}

export function meetingCreateHandler(
  graph: RecordStore,
): OperationHandler<{
  title: string;
  kind: MeetingKind;
  from: string;
  to: string;
  roomId?: string;
  attendees: ActorId[];
  externals?: Array<{ email: string }>;
}> {
  return {
    name: "meeting.create",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.title) missing.push("title");
      if (!args.kind) missing.push("kind");
      if (!args.from || !args.to) missing.push("from/to");
      // `execute` iterates `attendees` unconditionally, so omitting it threw a
      // TypeError out of the handler instead of being refused cleanly. Named in
      // `missing` — structured, so a caller can act on it — never as prose.
      if (!args.attendees || args.attendees.length === 0) missing.push("attendees");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "title, kind, from, to and at least one attendee are required.",
          };
    },
    permission: () => ({ action: "create", nodeType: "meeting" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const busy: string[] = [];
      for (const a of args.attendees) {
        if (await busyAt(graph, a, args.from, args.to)) busy.push(a);
      }
      const id = nextMeetingId();
      const linkId = `link_${id}`;
      let link: string | undefined;
      let providerMeetingId: string | undefined;
      if (args.kind === "online" || args.kind === "both") {
        // No silent failure. This used to swallow the provider error in an
        // empty `catch` and leave the link unset, producing an online meeting
        // with no way to join it and no error to say so — the worst possible
        // outcome, because it looks like success to everybody until the
        // meeting starts.
        //
        // The old line is deliberately NOT quoted here: outcome.md section 1
        // ships a by-hand grep for it, and a comment that trips it makes the
        // check useless to whoever runs it next.
        //
        // Throwing here reaches the caller as a rejection: `Spine` turns a
        // handler throw into `{ status: "rejected", detail }` rather than a
        // 500, so the organiser is told, and no meeting is written.
        try {
          const created = await providers().video.createMeeting({
            title: args.title,
            from: args.from,
            to: args.to,
            // Externals were a typed field and nothing else — the only mention
            // of them in `src/`. Passing them here is what makes Google email
            // the invitation, so no mail transport is needed for meetings.
            externals: args.externals,
          });
          link = created.link;
          // Kept, not discarded. This is the only handle cancel can use.
          providerMeetingId = created.id;
        } catch (error) {
          throw new Error(
            `Could not create a meeting link, so the meeting was not created. ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        if (!link) {
          throw new Error(
            "The video provider returned no meeting link, so the meeting was not created.",
          );
        }
      }
      // E7: in-person means a room; `both` means a room AND a link. Neither
      // happened before this phase — `roomId` was stored inertly.
      let room: RoomOutcome = {};
      if (args.kind === "in-person" || args.kind === "both") {
        room = await bookRoom(graph, ctx, {
          roomId: args.roomId,
          title: args.title,
          from: args.from,
          to: args.to,
          // Nothing supplied a capacity before, so the check could never fail
          // and the room could be smaller than the meeting.
          //
          // The plan says `attendees.length`. The ORGANISER is in the room too
          // and is not in `attendees` — the form does not add them — so a
          // meeting for three would have booked a room for two, which is a
          // smaller version of the very bug the capacity check exists to stop.
          // Counted as a set, since an organiser who did add themselves must
          // not count twice.
          capacity: new Set([ctx.actor, ...args.attendees]).size,
        });
      }

      const data: MeetingData = {
        title: args.title,
        kind: args.kind,
        from: args.from,
        to: args.to,
        // The room actually booked, which is not necessarily the one asked for
        // — `room.book` picks a suitable free one when none is named.
        roomId: room.roomId ?? args.roomId,
        bookingId: room.bookingId,
        linkId,
        link,
        providerMeetingId,
        organizer: ctx.actor,
        attendees: args.attendees,
        externals: args.externals ?? [],
      };
      // The meeting also goes on the common calendar. An EDGE, not a merge —
      // see SHOWN_ON_CALENDAR in calendar.ts for why merging the node types
      // would breach the one-type-wide open-node exemption.
      const entryId = nextEntryId();
      data.calendarEntryId = entryId;
      await graph.putNode("meeting", id, data);
      await graph.putNode("calendar-entry", entryId, entryDataFor(data, id));
      await graph.addEdge({ from: id, to: entryId, type: SHOWN_ON_CALENDAR });
      // E5: what changed, and who changed it. Without this the spine falls back
      // to summarizeChanges and every attendee reads "meeting:meeting_x changed".
      const message = meetingCreatedMessage({
        actor: ctx.actor,
        title: data.title,
        kind: data.kind,
        from: data.from,
        to: data.to,
        attendees: data.attendees,
        // E7: the link goes out WITH the invitation, in one action. `link` is
        // undefined for an in-person meeting and nothing is appended.
        link: data.link,
        // Which room, or why there is none. The organiser needs to know either
        // way, and neither is grounds for losing the meeting.
        room: room.name || room.reason ? { name: room.name, reason: room.reason } : undefined,
      });
      const publishTo = args.attendees.map((actor) => ({
        kind: "actor" as const,
        actor,
        message,
      }));
      const result: OperationResult = {
        changes: [{ nodeType: "meeting", nodeId: id, after: { ...data, busy } }],
        undo: {
          description: `Cancel meeting ${id}.`,
          revert: async () => {
            // Both nodes, the edge, AND the room. A meeting undone that leaves
            // its calendar entry alive is worse than never having shown it —
            // people plan around a meeting that no longer exists — and one that
            // leaves the room booked blocks it for a meeting nobody can see.
            if (room.bookingId) {
              await roomCancelHandler(graph).execute({ bookingId: room.bookingId }, ctx);
            }
            await graph.removeEdge(id, entryId, SHOWN_ON_CALENDAR);
            await graph.removeNode("calendar-entry", entryId);
            await graph.removeNode("meeting", id);
          },
          // Serialisable, so undo still works after a restart — the closure
          // above dies with the process (registry.ts, `UndoInfo.plan`). This is
          // why `meeting.create` could come off KNOWN_UNDO_GAPS.
          plan: [
            { op: "removeEdge", from: id, to: entryId, edgeType: SHOWN_ON_CALENDAR },
            { op: "remove", nodeType: "calendar-entry", nodeId: entryId },
            { op: "remove", nodeType: "meeting", nodeId: id },
            ...(room.bookingId
              ? ([{ op: "remove", nodeType: "booking", nodeId: room.bookingId }] as const)
              : []),
            ...(room.displaced
              ? ([
                  {
                    op: "patch",
                    nodeType: "booking",
                    nodeId: room.displaced.bookingId,
                    data: { roomId: room.displaced.roomId },
                  },
                ] as const)
              : []),
          ],
        },
        publishedTo: publishTo,
        response: {
          meetingId: id,
          entryId,
          linkId,
          link,
          providerMeetingId,
          bookingId: room.bookingId,
          roomId: room.roomId,
          roomReason: room.reason,
          busyAttendees: busy,
        },
      };
      return result;
    },
  };
}

export function meetingUpdateHandler(
  graph: RecordStore,
): OperationHandler<{
  meetingId: string;
  title?: string;
  from?: string;
  to?: string;
}> {
  return {
    name: "meeting.update",
    validate: (args) =>
      args.meetingId
        ? { ok: true }
        : { ok: false, missing: ["meetingId"], detail: "A meeting id is required." },
    permission: (args) => ({
      action: "edit",
      nodeType: "meeting",
      recordNodeIds: [args.meetingId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readMeeting(graph, args.meetingId);
      if (!before) throw new Error(`No meeting ${args.meetingId}`);
      const updated: MeetingData = {
        ...before,
        title: args.title ?? before.title,
        from: args.from ?? before.from,
        to: args.to ?? before.to,
      };
      // The room moves with the meeting.
      //
      // Not asked for by the prompt, but 6b is what gives a meeting a booking
      // at all — so without this, 6b would INTRODUCE a defect that did not
      // exist before it: a meeting at 15:00 whose room is held at 11:00. The
      // re-book goes through `room.book` so the new time is clash-checked like
      // any other, rather than the old booking simply having its times rewritten.
      let roomNote: string | undefined;
      const bookingBefore = before.bookingId
        ? (await graph.getNode("booking", before.bookingId))?.data
        : undefined;
      const timesChanged = before.from !== updated.from || before.to !== updated.to;
      if (timesChanged && before.bookingId) {
        await roomCancelHandler(graph).execute({ bookingId: before.bookingId }, ctx);
        const rebooked = await bookRoom(graph, ctx, {
          roomId: before.roomId,
          title: updated.title,
          from: updated.from,
          to: updated.to,
          capacity: new Set([updated.organizer, ...updated.attendees]).size,
        });
        updated.bookingId = rebooked.bookingId;
        updated.roomId = rebooked.roomId ?? before.roomId;
        // The old booking is NOT put back when the re-book fails: the meeting
        // has moved, so holding the old slot is wrong too. The organiser is
        // told instead, which is the same call `meeting.create` makes.
        roomNote = rebooked.bookingId
          ? rebooked.name
            ? ` Room: ${rebooked.name}.`
            : undefined
          : ` The room could not be moved — ${rebooked.reason} This meeting now has no room.`;
      }

      await graph.putNode("meeting", args.meetingId, updated);
      // The calendar entry moves with the meeting. An entry left showing the
      // old time is worse than no entry at all: people plan around it.
      const beforeEntry = updated.calendarEntryId
        ? (await graph.getNode("calendar-entry", updated.calendarEntryId))?.data
        : undefined;
      if (updated.calendarEntryId && beforeEntry) {
        await graph.putNode(
          "calendar-entry",
          updated.calendarEntryId,
          entryDataFor(updated, args.meetingId),
        );
      }
      // E5's own example sentence: "Arun moved Thursday's review from 11:00 to
      // 15:00." Only what actually differed is spoken.
      const message =
        meetingUpdatedMessage({
          actor: ctx.actor,
          before: { title: before.title, from: before.from, to: before.to },
          after: { title: updated.title, from: updated.from, to: updated.to },
        }) + (roomNote ?? "");
      return {
        changes: [
          {
            nodeType: "meeting",
            nodeId: args.meetingId,
            before: { title: before.title, from: before.from, to: before.to },
            after: { title: updated.title, from: updated.from, to: updated.to, linkPreserved: before.link },
          },
        ],
        undo: {
          description: `Revert meeting ${args.meetingId}.`,
          revert: async () => {
            await graph.putNode("meeting", args.meetingId, before);
            if (before.calendarEntryId && beforeEntry) {
              await graph.putNode("calendar-entry", before.calendarEntryId, beforeEntry);
            }
            // The room goes back to where it was. Undoing a move that leaves
            // the room at the new time is the same defect the move itself was
            // written to avoid.
            if (updated.bookingId && updated.bookingId !== before.bookingId) {
              await roomCancelHandler(graph).execute({ bookingId: updated.bookingId }, ctx);
            }
            if (before.bookingId && bookingBefore) {
              await graph.putNode("booking", before.bookingId, bookingBefore);
            }
          },
          plan: [
            { op: "put", nodeType: "meeting", nodeId: args.meetingId, data: before },
            ...(before.calendarEntryId && beforeEntry
              ? ([
                  {
                    op: "put",
                    nodeType: "calendar-entry",
                    nodeId: before.calendarEntryId,
                    data: beforeEntry as Record<string, unknown>,
                  },
                ] as const)
              : []),
            // Release the booking the move created...
            ...(updated.bookingId && updated.bookingId !== before.bookingId
              ? ([{ op: "remove", nodeType: "booking", nodeId: updated.bookingId }] as const)
              : []),
            // ...and put the one it replaced back where it was.
            ...(before.bookingId && bookingBefore
              ? ([
                  {
                    op: "put",
                    nodeType: "booking",
                    nodeId: before.bookingId,
                    data: bookingBefore as Record<string, unknown>,
                  },
                ] as const)
              : []),
          ],
        },
        publishedTo: before.attendees.map((actor) => ({ kind: "actor" as const, actor, message })),
      };
    },
  };
}

export function meetingAddAttendeeHandler(
  graph: RecordStore,
): OperationHandler<{ meetingId: string; attendee: ActorId }> {
  return {
    name: "meeting.addAttendee",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.meetingId) missing.push("meetingId");
      if (!args.attendee) missing.push("attendee");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "meetingId and attendee are required." };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "meeting",
      recordNodeIds: [args.meetingId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readMeeting(graph, args.meetingId);
      if (!before) throw new Error(`No meeting ${args.meetingId}`);
      const attendees = before.attendees.includes(args.attendee)
        ? before.attendees
        : [...before.attendees, args.attendee];
      const after = { ...before, attendees };
      await graph.putNode("meeting", args.meetingId, after);
      // The calendar entry's people move with the meeting's attendees, or the
      // common calendar shows a meeting the new person is not on.
      const beforeEntry = before.calendarEntryId
        ? (await graph.getNode("calendar-entry", before.calendarEntryId))?.data
        : undefined;
      if (before.calendarEntryId && beforeEntry) {
        await graph.putNode(
          "calendar-entry",
          before.calendarEntryId,
          entryDataFor(after, args.meetingId),
        );
      }
      // Only the person added is notified, so they read the "added you" form.
      const message = meetingAttendeeAddedMessage({
        actor: ctx.actor,
        title: before.title,
        attendee: args.attendee,
        from: before.from,
        to: before.to,
        forNewAttendee: true,
        // E7's ★ rule. This used to be returned to the CALLER as
        // `response.sentLinkTo` — visible to whoever made the request, never to
        // the person actually added. The UI has been labelling the button
        // "auto-sends link" on the strength of that.
        link: before.link,
      });
      return {
        changes: [{ nodeType: "meeting", nodeId: args.meetingId, after: { added: args.attendee } }],
        // This operation had NO UNDO AT ALL. Adding somebody to a meeting is
        // as reversible as anything else here, and E5 requires every change to
        // be undoable — the one that could not be was the one nobody noticed.
        undo: {
          description: `Take ${args.attendee} back off meeting ${args.meetingId}.`,
          revert: async () => {
            await graph.putNode("meeting", args.meetingId, before);
            if (before.calendarEntryId && beforeEntry) {
              await graph.putNode("calendar-entry", before.calendarEntryId, beforeEntry);
            }
          },
          plan: [
            { op: "put", nodeType: "meeting", nodeId: args.meetingId, data: before },
            ...(before.calendarEntryId && beforeEntry
              ? ([
                  {
                    op: "put",
                    nodeType: "calendar-entry",
                    nodeId: before.calendarEntryId,
                    data: beforeEntry as Record<string, unknown>,
                  },
                ] as const)
              : []),
          ],
        },
        publishedTo: [{ kind: "actor", actor: args.attendee, message }],
        response: { sentLinkTo: args.attendee, link: before.link },
      };
    },
  };
}

export function meetingCancelHandler(
  graph: RecordStore,
): OperationHandler<{ meetingId: string }> {
  return {
    name: "meeting.cancel",
    validate: (args) =>
      args.meetingId
        ? { ok: true }
        : { ok: false, missing: ["meetingId"], detail: "A meeting id is required." },
    permission: (args) => ({
      action: "edit",
      nodeType: "meeting",
      recordNodeIds: [args.meetingId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readMeeting(graph, args.meetingId);
      if (!before) throw new Error(`No meeting ${args.meetingId}`);
      // E7: "Cancelling the meeting ends the link." Nothing here could ever
      // have done that — `before.linkId` is local and means nothing to a
      // provider. The provider's own id is what goes back to it.
      let linkEnded: boolean | undefined;
      let linkEndFailure: string | undefined;
      if (before.link && before.providerMeetingId) {
        try {
          await providers().video.cancelMeeting(before.providerMeetingId);
          linkEnded = true;
        } catch (error) {
          // The meeting is still cancelled — losing the cancellation because a
          // third party was unreachable would be far worse. But a link that is
          // still live after the meeting is cancelled is something people need
          // told, so it is neither swallowed nor reported as success.
          linkEnded = false;
          linkEndFailure = error instanceof Error ? error.message : String(error);
        }
      } else if (before.link) {
        // A meeting created before the provider id was persisted. There is no
        // handle to cancel with, and saying so is better than claiming it ended.
        linkEnded = false;
        linkEndFailure = "No provider id was recorded for this meeting.";
      }

      // The room goes back. A cancelled meeting still holding its room blocks
      // it for a meeting nobody can see.
      let bookingReleased: boolean | undefined;
      const bookingBefore = before.bookingId
        ? (await graph.getNode("booking", before.bookingId))?.data
        : undefined;
      if (before.bookingId) {
        await roomCancelHandler(graph).execute({ bookingId: before.bookingId }, ctx);
        bookingReleased = true;
      }
      const cancelledData: MeetingData = {
        ...before,
        cancelled: true,
        ...(bookingReleased ? { bookingId: undefined } : {}),
        // Cleared only when the provider actually confirmed it. Clearing it
        // regardless would remove the last evidence that a live link is loose.
        ...(linkEnded === true ? { link: undefined } : {}),
      };
      await graph.putNode("meeting", args.meetingId, cancelledData);
      // ⚠ The trap. A meeting cancelled through `meeting.cancel` that leaves
      // its calendar entry alive is WORSE than never having shown it — people
      // plan around a meeting that no longer exists. `monthView` and
      // `/calendar` both key off `cancelled`, so marking it is what removes it
      // from the common calendar.
      const beforeEntry = before.calendarEntryId
        ? (await graph.getNode("calendar-entry", before.calendarEntryId))?.data
        : undefined;
      if (before.calendarEntryId && beforeEntry) {
        await graph.putNode(
          "calendar-entry",
          before.calendarEntryId,
          entryDataFor(cancelledData, args.meetingId),
        );
      }
      const message =
        meetingCancelledMessage({
          actor: ctx.actor,
          title: before.title,
          from: before.from,
          to: before.to,
        }) + (linkEnded === false ? " The join link could not be ended — it may still work." : "");
      return {
        changes: [
          {
            nodeType: "meeting",
            nodeId: args.meetingId,
            // `linkEnded: true` used to be written unconditionally and asserted
            // by nothing — a claim, never a fact. It is now whatever actually
            // happened, and absent entirely when there was no link to end.
            after: { cancelled: true, linkEnded, linkEndFailure, bookingReleased },
          },
        ],
        undo: {
          description: `Un-cancel meeting ${args.meetingId}.`,
          revert: async () => {
            await graph.putNode("meeting", args.meetingId, before);
            if (before.calendarEntryId && beforeEntry) {
              await graph.putNode("calendar-entry", before.calendarEntryId, beforeEntry);
            }
            // Un-cancelling has to take the room back too, or the meeting
            // returns to the calendar with nowhere to happen.
            if (before.bookingId && bookingBefore) {
              await graph.putNode("booking", before.bookingId, bookingBefore);
            }
          },
          plan: [
            { op: "put", nodeType: "meeting", nodeId: args.meetingId, data: before },
            ...(before.calendarEntryId && beforeEntry
              ? ([
                  {
                    op: "put",
                    nodeType: "calendar-entry",
                    nodeId: before.calendarEntryId,
                    data: beforeEntry as Record<string, unknown>,
                  },
                ] as const)
              : []),
            // The room comes back too, or the meeting returns to the calendar
            // with nowhere to happen.
            ...(before.bookingId && bookingBefore
              ? ([
                  {
                    op: "put",
                    nodeType: "booking",
                    nodeId: before.bookingId,
                    data: bookingBefore as Record<string, unknown>,
                  },
                ] as const)
              : []),
          ],
        },
        publishedTo: before.attendees.map((actor) => ({ kind: "actor" as const, actor, message })),
      };
    },
  };
}
