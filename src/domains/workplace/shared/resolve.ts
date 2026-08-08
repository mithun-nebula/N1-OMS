import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import type { ActorId } from "@/spine/operation/types";

export interface ResolvedPeople {
  picks: ActorId[];
  note?: string;
}

export function resolvePeople(
  input: ActorId[] | string | undefined,
): ResolvedPeople {
  if (!input) return { picks: [] };
  if (Array.isArray(input)) {
    const valid = input.filter((id) => DEMO_PEOPLE[id]);
    return { picks: valid };
  }
  const desc = input.toLowerCase();
  if (desc.includes("course")) {
    return {
      picks: Object.entries(DEMO_PEOPLE)
        .filter(([, p]) => p.team === "courses")
        .map(([id]) => id),
      note: "course team",
    };
  }
  if (desc.includes("ops") || desc.includes("operation")) {
    return {
      picks: Object.entries(DEMO_PEOPLE)
        .filter(([, p]) => p.team === "ops")
        .map(([id]) => id),
      note: "ops team",
    };
  }
  if (desc.includes("everyone") || desc.includes("all")) {
    return { picks: Object.keys(DEMO_PEOPLE), note: "everyone" };
  }
  const byName = Object.entries(DEMO_PEOPLE).find(([, p]) =>
    p.name.toLowerCase().includes(desc),
  );
  return byName ? { picks: [byName[0]], note: byName[1].name } : { picks: [] };
}
