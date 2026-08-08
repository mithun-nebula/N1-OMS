import type { DomainContext } from "../types";
import { DEMO_PEOPLE } from "../shared/people-roster";

export function seedPeople(ctx: DomainContext): void {
  for (const [id, person] of Object.entries(DEMO_PEOPLE)) {
    ctx.teams.set(id, person.team);
    ctx.graph.putNode("employee", id, {
      name: person.name,
      role: person.role,
      contact: `${id}@orga.example`,
      pay: 50000 + (hashPay(id) % 50000),
      performance: "meets",
      leaveBalance: 18,
    });
  }
  seedEquipment(ctx);
}

function seedEquipment(ctx: DomainContext): void {
  const assets: Array<{ id: string; name: string; assignee: string }> = [
    { id: "laptop-1", name: "MacBook Pro 14", assignee: "meena" },
    { id: "laptop-2", name: "MacBook Air", assignee: "meena" },
  ];
  for (const a of assets) {
    ctx.graph.putNode("equipment", a.id, {
      name: a.name,
      assignee: a.assignee,
      status: "assigned",
    });
    ctx.graph.addEdge({ from: a.assignee, to: a.id, type: "holds" });
  }
}

function hashPay(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}
