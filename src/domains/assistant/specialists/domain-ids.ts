/**
 * The ten areas, as a value.
 *
 * ⚠ **This file imports nothing, and that is the whole reason it exists.**
 *
 * `domains.ts` imports `ALL_TOOLS` from `tools/index.ts`, so anything under
 * `tools/` that needs the domain list as a **runtime value** — a zod enum, say
 * — cannot import it from there without the two modules importing each other.
 * `domains.ts` already carries a warning about exactly that: *"ES modules
 * survive it, but only because nothing touches `ALL_TOOLS` at load time — a
 * fragile property nobody would know they had to preserve. One import
 * direction, kept."*
 *
 * A type import is erased and would have been fine. A `z.enum` needs the
 * strings themselves.
 *
 * So the list lives here, once, and `DomainId` is derived from it. Writing the
 * ten strings out a second time inside a tool schema would be the "new
 * vocabulary" the plan forbids — correct on the day it is written and quietly
 * wrong the first time an area is added.
 */
export const DOMAIN_IDS = [
  "hr",
  "leave-expenses",
  "meetings",
  "calendar-events",
  "courses",
  "tasks",
  "facilities",
  "documents",
  "day",
  "memory",
] as const;

export type DomainId = (typeof DOMAIN_IDS)[number];
