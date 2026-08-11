import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const result = await (await getSpine()).undo(id, user.id);
  const status = result.status === "undone" ? 200 : result.status === "not-found" ? 404 : 400;
  return NextResponse.json(result, { status });
}
