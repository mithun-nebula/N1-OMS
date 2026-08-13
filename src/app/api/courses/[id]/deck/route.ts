import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getCourseService, getSpine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  const { id } = await params;
  const read = await (await getSpine()).read({ actor: user.id, nodeType: "course", nodeId: id });
  if (!read.found) {
    return NextResponse.json({ error: "That course is not available." }, { status: 404 });
  }
  let body: { topic?: string } = {};
  try {
    body = (await request.json()) as { topic?: string };
  } catch {
    body = {};
  }
  const deck = await (await getCourseService()).generateDeck({ courseId: id, topic: body.topic });
  return NextResponse.json({ courseId: id, ...deck });
}
