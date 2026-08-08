import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";

interface RoomData {
  name: string;
  capacity: number;
  equipment: string[];
  [key: string]: unknown;
}

interface BookingData {
  roomId: string;
  title: string;
  by: string;
  from: string;
  to: string;
  [key: string]: unknown;
}

let bookingSeq = 0;
function nextBookingId(): string {
  bookingSeq += 1;
  return `booking_${Date.now().toString(36)}_${bookingSeq}`;
}

function readRoom(graph: RecordStore, roomId: string): RoomData | undefined {
  return graph.getNode("room", roomId)?.data as RoomData | undefined;
}

function overlapping(aFrom: string, aTo: string, bFrom?: string, bTo?: string): boolean {
  if (!bFrom || !bTo) return false;
  return aFrom < bTo && bFrom < aTo;
}

function bookingsFor(
  graph: RecordStore,
  roomId: string,
): Array<{ id: string; roomId: string; title: string; by: string; from: string; to: string }> {
  return graph
    .find("booking", (n) => (n.data as { roomId?: string }).roomId === roomId)
    .map((n) => {
      const d = n.data as BookingData;
      return {
        id: n.id,
        roomId: d.roomId,
        title: d.title,
        by: d.by,
        from: d.from,
        to: d.to,
      };
    });
}

function findClash(graph: RecordStore, roomId: string, from: string, to: string) {
  return bookingsFor(graph, roomId).find((b) => overlapping(from, to, b.from, b.to));
}

function suitableRooms(graph: RecordStore, capacity?: number, equipment?: string[]) {
  return graph.find("room", () => true).filter((r) => {
    const data = r.data as RoomData;
    if (capacity && data.capacity < capacity) return false;
    if (equipment && !equipment.every((e) => data.equipment.includes(e))) return false;
    return true;
  });
}

export function roomBookHandler(
  graph: RecordStore,
): OperationHandler<{
  roomId?: string;
  title: string;
  from: string;
  to: string;
  capacity?: number;
  equipment?: string[];
  displaceClash?: boolean;
}> {
  return {
    name: "room.book",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.title) missing.push("title");
      if (!args.from) missing.push("from");
      if (!args.to) missing.push("to");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "title, from and to are required." };
    },
    permission: (args) => ({
      action: "create",
      nodeType: "booking",
      recordNodeIds: args.roomId ? [args.roomId] : undefined,
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      let roomId = args.roomId;
      if (!roomId) {
        const match = suitableRooms(graph, args.capacity, args.equipment).find(
          (r) => !findClash(graph, r.id, args.from, args.to),
        );
        if (!match) {
          return {
            changes: [],
            publishedTo: [],
            response: { resolved: false, reason: "No suitable room available." },
          };
        }
        roomId = match.id;
      } else {
        const room = readRoom(graph, roomId);
        if (args.capacity && room && room.capacity < args.capacity) {
          return {
            changes: [],
            publishedTo: [],
            response: {
              resolved: false,
              reason: `${room.name} is too small (needs capacity ${args.capacity}).`,
            },
          };
        }
      }

      const clash = findClash(graph, roomId, args.from, args.to);
      if (clash) {
        const alternatives = suitableRooms(graph, args.capacity, args.equipment)
          .filter((r) => r.id !== roomId && !findClash(graph, r.id, args.from, args.to))
          .map((r) => r.id);
        if (args.displaceClash && alternatives.length > 0) {
          const movedTo = alternatives[0];
          graph.putNode("booking", clash.id, { ...clash, roomId: movedTo });
          const booking = createBooking(graph, roomId, args.title, ctx.actor, args.from, args.to);
          return {
            changes: [
              { nodeType: "booking", nodeId: booking.id, after: booking },
              {
                nodeType: "booking",
                nodeId: clash.id,
                before: { roomId: clash.roomId },
                after: { roomId: movedTo, movedFrom: roomId },
              },
            ],
            publishedTo: [
              { kind: "record", nodeType: "room", nodeId: roomId },
              { kind: "actor", actor: clash.by },
            ],
            response: { resolved: true, bookingId: booking.id, displaced: clash.id, movedTo },
          };
        }
        return {
          changes: [],
          publishedTo: [],
          response: { resolved: false, clash: clash.id, alternatives },
        };
      }

      const booking = createBooking(graph, roomId, args.title, ctx.actor, args.from, args.to);
      const result: OperationResult = {
        changes: [{ nodeType: "booking", nodeId: booking.id, after: booking }],
        publishedTo: [{ kind: "record", nodeType: "room", nodeId: roomId }],
        response: { resolved: true, bookingId: booking.id },
      };
      return result;
    },
  };
}

function createBooking(
  graph: RecordStore,
  roomId: string,
  title: string,
  by: string,
  from: string,
  to: string,
): BookingData & { id: string } {
  const id = nextBookingId();
  const data: BookingData = { roomId, title, by, from, to };
  graph.putNode("booking", id, data);
  return { id, ...data };
}

export function roomCancelHandler(
  graph: RecordStore,
): OperationHandler<{ bookingId: string }> {
  return {
    name: "room.cancel",
    validate: (args) =>
      args.bookingId
        ? { ok: true }
        : { ok: false, missing: ["bookingId"], detail: "A booking id is required." },
    permission: () => ({ action: "edit", nodeType: "booking" }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = graph.getNode("booking", args.bookingId)?.data as BookingData | undefined;
      graph.removeNode("booking", args.bookingId);
      return {
        changes: [{ nodeType: "booking", nodeId: args.bookingId, before, after: { cancelled: true } }],
        undo: {
          description: `Restore booking ${args.bookingId}.`,
          revert: () => {
            if (before) graph.putNode("booking", args.bookingId, before);
          },
        },
        publishedTo: before ? [{ kind: "record", nodeType: "room", nodeId: before.roomId }] : [],
      };
    },
  };
}
