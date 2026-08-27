import { directory } from "@/server/directory";
import type { ActorId } from "@/spine/operation/types";

/**
 * A person, from an id or a name.
 *
 * `create_task` used to ask for an "Employee id" and to omit the field if
 * unsure. A model told *"create a task for Arun"* holds no id, so it omitted
 * it — and the task arrived on the board **unassigned**, with nothing saying
 * why. The task existed, the person did not get it, and nobody was told.
 *
 * Three answers, and the ambiguous one matters most: **two similar names never
 * resolve to the nearer.** Picking between them is precisely the mistake that
 * puts work on the wrong person, and it is invisible afterwards.
 */
export type PersonMatch =
  | { kind: "one"; id: ActorId }
  | { kind: "none" }
  | { kind: "many"; names: string[] };

export function resolvePerson(given: string): PersonMatch {
  const dir = directory();
  const raw = given.trim();

  // An id already — the common case when a read tool supplied it.
  if (dir.isActive(raw)) return { kind: "one", id: raw };

  const needle = raw.toLowerCase();
  const active = dir.all().filter((p) => p.active);

  // Exact name first, so "Arun" cannot be beaten by "Arunachalam" on a
  // substring match.
  const exact = active.filter((p) => p.name.toLowerCase() === needle);
  if (exact.length === 1) return { kind: "one", id: exact[0].id };
  if (exact.length > 1) return { kind: "many", names: exact.map((p) => p.name) };

  // Then a first-name or partial match, which is how people actually speak.
  const partial = active.filter((p) => {
    const name = p.name.toLowerCase();
    return name === needle || name.startsWith(`${needle} `) || name.includes(needle);
  });
  if (partial.length === 1) return { kind: "one", id: partial[0].id };
  if (partial.length > 1) return { kind: "many", names: partial.map((p) => p.name) };

  return { kind: "none" };
}
