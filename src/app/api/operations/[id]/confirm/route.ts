import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getSpine } from "@/server/runtime";

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
  const result = await (await getSpine()).confirm(id, user.id);
  const status =
    result.status === "ran" ? 200 : result.status === "not-found" ? 404 : 400;
  return NextResponse.json(result, { status });
}
