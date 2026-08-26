import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getSpine } from "@/server/runtime";
import { tapApprove, tapDiscard } from "@/server/voice/tap";

export const dynamic = "force-dynamic";

/**
 * ⚠ **The other half of "voice prepares, a finger issues".**
 *
 * `approve_proposal` is absent from the live tool set, so nothing the model
 * says can complete a money or people operation. This is where the person's
 * own hand completes it — reached with the session cookie their browser holds,
 * which **a model cannot forge**. See `src/server/voice/tap.ts` for why that
 * distinction is the whole of §6.1.
 *
 * The operation is submitted for the first time here, as `start: "typed"`,
 * through the same `Spine.submit`, the same gate, the same permission policy
 * and the same activity log as every other write in this product.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getActingUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const outcome = await tapApprove({ spine: await getSpine(), actor: auth.user.id, proposalId: id });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason }, { status: outcome.status });
  }
  return NextResponse.json({ ok: true, did: outcome.did, summary: outcome.summary });
}

/** Throw one away. Needs no consent — see `tapDiscard`. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getActingUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!tapDiscard(auth.user.id, id)) {
    return NextResponse.json({ error: "There is nothing waiting with that id." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
