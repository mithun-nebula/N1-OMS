import type { DomainContext } from "../types";
import { DEMO_PEOPLE } from "../shared/people-roster";

export async function seedPeople(ctx: DomainContext): Promise<void> {
  for (const [id, person] of Object.entries(DEMO_PEOPLE)) {
    ctx.teams.set(id, person.team);
    await ctx.graph.putNode("employee", id, {
      name: person.name,
      role: person.role,
      // `team` has to live on the record, not only in the in-memory map.
      // The people directory rebuilds itself from these nodes after a restart,
      // and a person with no team lands in no team scope — which silently
      // empties every manager's `own-team` permission.
      team: person.team,
      status: "active",
      contact: `${id}@orga.example`,
      pay: 50000 + (hashPay(id) % 50000),
      performance: "meets",
      leaveBalance: 18,
    });
  }
  await seedEquipment(ctx);
}

async function seedEquipment(ctx: DomainContext): Promise<void> {
  const assets: Array<{ id: string; name: string; assignee: string }> = [
    { id: "laptop-1", name: "MacBook Pro 14", assignee: "meena" },
    { id: "laptop-2", name: "MacBook Air", assignee: "meena" },
  ];
  for (const a of assets) {
    await ctx.graph.putNode("equipment", a.id, {
      name: a.name,
      assignee: a.assignee,
      status: "assigned",
    });
    await ctx.graph.addEdge({ from: a.assignee, to: a.id, type: "holds" });
  }
}

function hashPay(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}
