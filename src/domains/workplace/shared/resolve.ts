import { directory } from "@/server/directory";
import type { ActorId } from "@/spine/operation/types";

export interface ResolvedPeople {
  picks: ActorId[];
  note?: string;
}

export function resolvePeople(
  input: ActorId[] | string | undefined,
): ResolvedPeople {
  const people = directory();
  if (!input) return { picks: [] };
  if (Array.isArray(input)) {
    // Unknown or deactivated ids are dropped rather than rejected — adding
    // someone who has left should quietly not happen, not fail the whole call.
    return { picks: input.filter((id) => people.isActive(id)) };
  }
  const desc = input.toLowerCase();

  if (desc.includes("everyone") || desc.includes("all")) {
    return { picks: people.activeIds(), note: "everyone" };
  }

  // Any team, by name, however it was phrased: "course team" has to match the
  // team called "courses", and "ops" has to match "ops" — so compare on the
  // singular stem, at word boundaries. Substring matching is too loose: "op"
  // inside "open day" is not a reference to the ops team.
  for (const team of people.teams()) {
    if (mentionsTeam(desc, team)) {
      return { picks: people.membersOfTeam(team), note: `${team} team` };
    }
  }
  if (desc.includes("operation")) {
    const ops = people.membersOfTeam("ops");
    if (ops.length > 0) return { picks: ops, note: "ops team" };
  }

  const match = people.findByName(desc);
  return match ? { picks: [match.id], note: match.name } : { picks: [] };
}

function mentionsTeam(description: string, team: string): boolean {
  const stem = team.toLowerCase().replace(/s$/, "");
  if (!stem) return false;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}s?\\b`).test(description);
}
