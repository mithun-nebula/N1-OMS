import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { WRITE_SPECS } from "@/domains/assistant/tools/write";

/**
 * A write tool's schema must agree with the operation's own `validate()`.
 *
 * ── What this replaces, and why ─────────────────────────────────────────────
 *
 * Phase 3's plan asked for an optional `argsSchema` on `OperationHandler`, so
 * that the tool's schema and the handler sat in one place and could not drift.
 * That field was added — and then **populated on nothing and read by nothing**,
 * because there is no way to fill it that does not simply move the catalogue.
 *
 * A declared-but-unused field is the `assertAtomic` shape all over again: it
 * reads as protection in review and protects nothing. Phase 2.5 settled how
 * that goes — wire it or delete it, and say which. **Deleted.**
 *
 * What the field was *for* is worth keeping, so it is a test instead. The risk
 * was never the co-location; it was drift. So this derives what each operation
 * genuinely requires — by calling `validate({})` and reading the `missing` it
 * names itself — and asserts the tool asks for those same things and marks them
 * required.
 *
 * A mechanism beats a convention: co-locating two declarations makes drift
 * *visible*, this makes it *fail*.
 *
 * ── `validate()` stays the authority ────────────────────────────────────────
 *
 * ⚠ This does not make the schema authoritative and must never be read that
 * way. A schema says *this is a string, that is a date*. It cannot say *"you
 * cannot approve your own leave"*, and two rules that can disagree is worse
 * than one rule plus a schema that admits its limits. `validate()` runs on
 * every submission exactly as before. This only checks the two agree about
 * SHAPE.
 */

let world: DemoWorld;

beforeEach(async () => {
  world = await buildDemoWorld();
});

/** The fields an operation names as missing when given nothing at all. */
async function requiredByValidate(operation: string): Promise<string[] | undefined> {
  const handler = world.registry.get(operation);
  if (!handler) return undefined;
  try {
    const result = await handler.validate({} as never);
    if (result.ok) return [];
    return [...(result.missing ?? [])];
  } catch {
    // A `validate` that throws on empty args tells us nothing about shape.
    return undefined;
  }
}

/** The fields a tool's schema declares, and which of them are required. */
function schemaFields(schema: z.ZodObject<z.ZodRawShape>): {
  all: string[];
  required: string[];
} {
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const all = Object.keys(shape);
  const required = all.filter((k) => !shape[k].safeParse(undefined).success);
  return { all, required };
}

describe("every write tool's schema agrees with its operation", () => {
  it("asks for everything the operation says it needs", async () => {
    const mismatches: string[] = [];

    for (const spec of WRITE_SPECS) {
      const needed = await requiredByValidate(spec.operation);
      if (needed === undefined) continue;
      const { all } = schemaFields(spec.args);

      for (const field of needed) {
        // `validate` sometimes names a pair, e.g. "from/to". Either half
        // being present is the operation's own meaning of that name.
        const parts = field.split("/");
        if (!parts.some((part) => all.includes(part))) {
          mismatches.push(
            `${spec.tool} (${spec.operation}): validate() requires "${field}", ` +
              `but the tool's schema has no such field — the model cannot supply it`,
          );
        }
      }
    }

    expect(
      mismatches,
      `A tool cannot satisfy the operation it wraps:\n  ${mismatches.join("\n  ")}`,
    ).toEqual([]);
  });

  it("marks those fields REQUIRED, so the model is not left to guess", async () => {
    const optionalButNeeded: string[] = [];

    for (const spec of WRITE_SPECS) {
      const needed = await requiredByValidate(spec.operation);
      if (needed === undefined) continue;
      const { required } = schemaFields(spec.args);

      for (const field of needed) {
        const parts = field.split("/");
        // Required if any half of the name is required. A pair like "from/to"
        // is satisfied by the operation's own reading of it.
        if (parts.some((part) => required.includes(part))) continue;
        // Not present at all is the other test's business, not this one.
        const { all } = schemaFields(spec.args);
        if (!parts.some((part) => all.includes(part))) continue;
        optionalButNeeded.push(
          `${spec.tool} (${spec.operation}): "${field}" is optional in the schema ` +
            "but required by validate(), so the model will be refused after it calls",
        );
      }
    }

    expect(
      optionalButNeeded,
      `Optional in the tool, required by the operation:\n  ${optionalButNeeded.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the dead `argsSchema` field is gone, not left declared and unread", async () => {
    // The decision, pinned. If somebody re-adds it, they have to populate it —
    // and this test is where they will find out that nothing reads it.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/spine/operation/registry.ts", "utf8");
    expect(
      src.includes("argsSchema"),
      "argsSchema is back on OperationHandler. Populate it and make something " +
        "read it, or take it out again — a declared field nothing uses reads as " +
        "protection and protects nothing.",
    ).toBe(false);
  });
});
