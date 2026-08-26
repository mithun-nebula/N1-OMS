import type { Server } from "node:http";
import { localDate } from "@/domains/assistant/day-plan/time";
import { CourseService } from "@/domains/course/service";
import {
  getWorld,
  getDayPlanService,
  getCommitmentStore,
  getMessageStore,
  getAutonomyEngine,
  getMemoryStore,
} from "@/server/runtime";
import { attachVoiceUpgrade, type AttachedVoice } from "./attach";
import { openVoiceSession } from "./session";
import { VertexLiveEndpoint } from "./live-vertex";
import { buildVoiceContext, contextSentence } from "./context";
import type { LiveEndpoint } from "./live-endpoint";

/**
 * Where the custom server meets the application.
 *
 * `server.ts` knows how to accept an upgrade; `session.ts` knows how to hold a
 * conversation. This is the one place that knows both, and it exists so that
 * neither has to import the other's world — `server.ts` stays a shim, and
 * `session.ts` stays testable with a plain object for every dependency.
 *
 * The dependency record is the **same one `assistantAsk` builds**, deliberately:
 * a spoken `room.book` reaches the same spine, the same gate, the same
 * permission policy and the same activity log as a typed one because it is
 * literally the same tool over the same deps. Voice gets no path of its own to
 * anything.
 */
export function startVoice(server: Server, opts: { endpoint?: LiveEndpoint } = {}): AttachedVoice {
  const endpoint = opts.endpoint ?? new VertexLiveEndpoint();

  return attachVoiceUpgrade(server, {
    onConnection: (conn) => {
      let close: (reason: string) => void = () => conn.socket.close(1011, "session never opened");

      void (async () => {
        try {
          const world = await getWorld();
          const deps = {
            spine: world.spine,
            graph: world.deps.graph,
            figures: world.deps.figures,
            permissions: world.deps.permissions,
            courses: new CourseService(world.deps.graph, world.deps.figures),
            dayPlan: await getDayPlanService(),
            commitments: await getCommitmentStore(),
            messages: await getMessageStore(),
            autonomy: await getAutonomyEngine(),
            memory: await getMemoryStore(),
            today: localDate,
          };

          const session = await openVoiceSession({
            user: conn.user,
            browser: conn.socket,
            endpoint,
            deps,
            // What they can see and what is on screen, permission-filtered
            // before it is ever spoken about. The `viewing` values come off the
            // upgrade URL's query string — see `attach.ts`.
            context: async () => {
              const route = conn.params.get("route");
              const ctx = await buildVoiceContext({
                spine: world.spine,
                actor: conn.user.id,
                viewing: route
                  ? {
                      route,
                      nodeType: conn.params.get("nodeType") ?? undefined,
                      nodeId: conn.params.get("nodeId") ?? undefined,
                    }
                  : undefined,
              });
              return contextSentence(ctx);
            },
            log: (message, detail) => console.log(`[voice:${conn.user.id}] ${message}`, detail ?? ""),
          });
          close = session.close;
        } catch (e) {
          // Opening a session must never leave a socket hanging with nothing on
          // it. Say so, in words, and go.
          console.error("[voice] could not open a session", e);
          try {
            conn.socket.send(
              JSON.stringify({
                type: "notice",
                message: "Voice is not available right now. Every screen still works as normal.",
              }),
            );
          } catch {
            /* the browser may already be gone */
          }
          conn.socket.close(1011, "voice unavailable");
        }
      })();

      // Returned synchronously, so a shutdown arriving DURING the async open
      // above still has something to close. The closure is reassigned once the
      // session exists.
      return { close: (reason: string) => close(reason) };
    },
  });
}
