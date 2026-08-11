import type { DomainContext } from "../types";

export async function seedWorkplace(ctx: DomainContext): Promise<void> {
  const rooms: Array<{ id: string; name: string; capacity: number; equipment: string[] }> = [
    { id: "hall-1", name: "Hall 1", capacity: 60, equipment: ["projector", "mics", "ac"] },
    { id: "hall-2", name: "Hall 2", capacity: 30, equipment: ["projector", "ac"] },
    { id: "small-room", name: "Small Room", capacity: 8, equipment: ["tv"] },
  ];
  for (const r of rooms) {
    await ctx.graph.putNode("room", r.id, {
      name: r.name,
      capacity: r.capacity,
      equipment: r.equipment,
    });
  }

  await ctx.graph.putNode("equipment", "projector-hall-1", {
    name: "Hall 1 Projector",
    assignee: "hall-1",
    status: "ok",
  });

  await ctx.graph.putNode("calendar-entry", "cal-showcase", {
    title: "SHOWCASE",
    kind: "event",
    date: "2026-08-18",
    people: ["james", "priya", "arun"],
  });
  await ctx.graph.putNode("calendar-entry", "cal-town-hall", {
    title: "TOWN HALL",
    kind: "event",
    date: "2026-08-28",
    people: [],
  });
}
