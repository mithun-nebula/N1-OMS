import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getSpine } from "@/server/runtime";
import { emitChange } from "@/server/live";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  const { id } = await params;
  const result = await (await getSpine()).undo(id, user.id);
  if (result.status === "undone") {
    // Live updates: an undo changes records like any write does.
    emitChange("operations");
    emitChange("notifications");
  }
  const status = result.status === "undone" ? 200 : result.status === "not-found" ? 404 : 400;
  return NextResponse.json(result, { status });
}
