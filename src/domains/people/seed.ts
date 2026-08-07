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
}

function hashPay(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}
