import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getCourseService, getSpine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const spine = await getSpine();
  const all = await (await getCourseService()).listProgress();
  const visible = (
    await Promise.all(
      all.map(async (c) => {
        const r = await spine.read({ actor: user.id, nodeType: "course", nodeId: c.id });
        return r.found ? c : null;
      }),
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);
  return NextResponse.json({ courses: visible, viewedBy: user.id });
}
