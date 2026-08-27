import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { subscribeChanges } from "@/server/live";

export const dynamic = "force-dynamic";

/**
 * The live-update stream — one thin Server-Sent Events wire per open tab.
 *
 * The server stays silent until a write happens somewhere (form, chat, voice,
 * automation), then sends `event: change` with the areas that moved. The tab
 * re-fetches through normal permission-checked reads — events never carry
 * record data (see `src/server/live.ts` for why that is the security model).
 *
 * This is an ordinary long-lived HTTP response — no upgrade — so it coexists
 * with the voice WebSocket without touching the upgrade fence.
 */

const HEARTBEAT_MS = 25_000;

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The tab is gone; cancel() will clean up.
        }
      };
      send(`: connected\n\n`);
      unsubscribe = subscribeChanges((areas) => {
        send(`event: change\ndata: ${JSON.stringify({ areas })}\n\n`);
      });
      // Comment frames keep proxies from closing an idle connection.
      heartbeat = setInterval(() => send(`: hb\n\n`), HEARTBEAT_MS);
      heartbeat.unref?.();
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
