import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getCourseService, getSpine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const spine = getSpine();
  const all = getCourseService().listProgress();
  const visible = all.filter((c) =>
    spine.read({ actor: user.id, nodeType: "course", nodeId: c.id }).found,
  );
  return NextResponse.json({ courses: visible, viewedBy: user.id });
}
