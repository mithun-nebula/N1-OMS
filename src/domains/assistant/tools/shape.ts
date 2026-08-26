import { isRestricted } from "@/spine/permission/types";

/**
 * Shaping and capping. Every tool does both, inside itself.
 *
 * Two reasons, and the second is the one people forget:
 *
 * 1. A raw `readMany` over a real organisation floods the context window and
 *    costs real money on every turn.
 * 2. **Without `truncated`, the model says "you have 20 tasks" when you have
 *    ninety** — and states it with the same confidence as a true answer. A cap
 *    that does not announce itself is a lie the model tells on your behalf.
 *
 * So the envelope is uniform across all fifteen tools: `items`, the real
 * `total`, and whether anything was left out. Uniform because a small model
 * reading fifteen differently-shaped results has fifteen chances to
 * misunderstand one.
 */

/** Deliberately small. A question answered from twenty rows is answerable. */
export const DEFAULT_CAP = 20;

export interface Shaped<T> {
  items: T[];
  /** How many there really are, not how many are shown. */
  total: number;
  /** True when `items` is only part of `total`. */
  truncated: boolean;
  /** Present only when truncated, so the model can say what to do about it. */
  note?: string;
}

export function shape<T, U>(
  rows: readonly T[],
  map: (row: T, index: number) => U,
  opts: { cap?: number } = {},
): Shaped<U> {
  const cap = opts.cap ?? DEFAULT_CAP;
  const truncated = rows.length > cap;
  return {
    items: rows.slice(0, cap).map(map),
    total: rows.length,
    truncated,
    ...(truncated
      ? {
          note: `Showing ${cap} of ${rows.length}. Narrow the question to see the rest — do not describe this as the full list.`,
        }
      : {}),
  };
}

/** Drop undefined/empty fields so the model is not handed noise to reason about. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * A field the field policy may have masked.
 *
 * `applyFieldPolicy` does not delete a field the reader may not see — it
 * replaces the value with `{ __restricted: true, label: "Restricted" }` and
 * **adds the key even when the record never had it**, so that "no such field"
 * and "not yours to see" look identical. That is non-negotiable #2 working as
 * designed.
 *
 * A tool must therefore drop these rather than pass them on. Handing the model
 * `{ pay: { __restricted: true } }` teaches it that a pay field exists and
 * invites "I can see there is a pay figure but I am not allowed to show it" —
 * which discloses the very thing the mask was protecting.
 */
export function visible(value: unknown): unknown | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (isRestricted(value)) return undefined;
  return value;
}

/** `compact` + `visible` in one pass — what every tool's row mapper wants. */
export function safeFields<T extends Record<string, unknown>>(
  record: Record<string, unknown>,
  fields: readonly (keyof T & string)[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = visible(record[field]);
    if (value !== undefined) out[field] = value;
  }
  return out as Partial<T>;
}
