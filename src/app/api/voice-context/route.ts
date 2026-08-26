import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { buildVoiceContext } from "@/server/voice/context";

export const dynamic = "force-dynamic";

/**
 * Reference data the voice session needs: who am I, which rooms and equipment
 * exist, and — since Phase 6 — **what the person is looking at**.
 *
 * Everything flows through `spine.readMany` / `spine.read`, so the viewer only
 * sees what their own permissions allow. That was already true of the rooms and
 * equipment; `viewing` is the new part, and it is the one that most looks like
 * it could skip a check. Both rules live in `server/voice/context.ts`:
 *
 *  1. it goes through the spine, because **being on a page is not permission to
 *     see what is on it** — `viewing` arrives from a browser, which is to say
 *     from whoever is holding it, and a deep link can be typed by anybody;
 *  2. it is a **hint, not an instruction** — it may fill in a blank, and it may
 *     never skip a gate.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const spine = await getSpine();

  const params = req.nextUrl.searchParams;
  const route = params.get("route");

  const context = await buildVoiceContext({
    spine,
    actor: user.id,
    viewing: route
      ? {
          route,
          nodeType: params.get("nodeType") ?? undefined,
          nodeId: params.get("nodeId") ?? undefined,
        }
      : undefined,
  });

  return NextResponse.json(context);
}
