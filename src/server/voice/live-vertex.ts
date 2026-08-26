import { env } from "@/config/env";
import {
  AUDIO_MIME,
  type LiveConnection,
  type LiveEndpoint,
  type LiveHandlers,
  type LiveServerFrame,
  type LiveSetup,
} from "./live-endpoint";

/**
 * The real thing: a WebSocket to Vertex's bidirectional live endpoint.
 *
 * ── ⚠ THE CREDENTIAL LIVES HERE AND NOWHERE ELSE ────────────────────────────
 *
 * Audio cannot go from the browser to Google directly. Doing so would put the
 * service-account key in the browser, where anyone could take it and bill the
 * project. So the token is minted **in this process**, attached to **this**
 * socket's upgrade request, and never travels in any direction the browser can
 * see. `relay.test.ts` asserts that by inspecting everything the browser
 * socket receives, rather than trusting this paragraph.
 *
 * ── Why Node's built-in WebSocket and not `ws` ───────────────────────────────
 *
 * Node 24's global `WebSocket` accepts request headers, which is all the
 * upstream half needs, so this half has no dependency. `ws` is used only for
 * the DOWNSTREAM half, because Node has no WebSocket *server*.
 */
export class VertexLiveEndpoint implements LiveEndpoint {
  readonly id = "vertex-live";

  private async accessToken(): Promise<string> {
    // Dynamic, exactly as `VertexLlmProvider` does it: merely loading this
    // module must not pull in `google-auth-library`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleAuth } = require("google-auth-library") as typeof import("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const token = (await (await auth.getClient()).getAccessToken()).token;
    if (!token) throw new Error("Vertex live: could not mint an access token from the service account.");
    return token;
  }

  private projectId(): string {
    const configured = env().vertexProject;
    if (configured && configured !== "your-gcp-project-id") return configured;
    const keyPath = env().vertexCredentials;
    if (keyPath) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync } = require("node:fs") as typeof import("node:fs");
      const parsed = JSON.parse(readFileSync(keyPath, "utf8")) as { project_id?: string };
      if (parsed.project_id) return parsed.project_id;
    }
    throw new Error("Vertex live: no project id (GOOGLE_VERTEX_PROJECT, or a key that names one).");
  }

  async open(setup: LiveSetup, handlers: LiveHandlers): Promise<LiveConnection> {
    const region = env().vertexLiveLocation;
    const project = this.projectId();
    const host = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
    const url = `wss://${host}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
    const token = await this.accessToken();

    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
    } as unknown as string[]);

    let closed = false;

    /**
     * ⚠ Anything sent before the socket finishes opening is HELD, not dropped.
     *
     * `open()` resolves as soon as the WebSocket is constructed, which is
     * before `onopen` fires — so the very first thing the session says, the
     * opening screen context, arrived while `readyState` was still
     * CONNECTING and went nowhere. There was no error and no log line: the
     * model simply never learned what was on the person's screen, and asked
     * *"which room?"* about the room they were looking at.
     *
     * Held here rather than fixed by awaiting `onopen` in `open()`, because a
     * caller that has to remember to wait is a caller that will forget.
     */
    const pending: unknown[] = [];
    let ready = false;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: `projects/${project}/locations/${region}/publishers/google/models/${setup.model}`,
            generationConfig: {
              // ⚠ AUDIO only. This model closes the socket with 1007 —
              // "Text output is not supported for native audio output model" —
              // if TEXT is asked for. The on-screen transcript comes from the
              // transcription config below instead.
              responseModalities: ["AUDIO"],
              ...(setup.voiceName
                ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voiceName } } } }
                : {}),
            },
            systemInstruction: { parts: [{ text: setup.systemInstruction }] },
            // Both directions, because a person who can SEE what it heard
            // catches a mishearing before it becomes an action.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Server-side voice activity detection is what makes barge-in work
            // without the browser having to decide when somebody started talking.
            realtimeInputConfig: { automaticActivityDetection: {} },
            ...(setup.tools.length
              ? {
                  tools: [
                    {
                      functionDeclarations: setup.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                      })),
                    },
                  ],
                }
              : {}),
          },
        }),
      );
      // The setup frame is on the wire; anything the session tried to say
      // while we were connecting can follow it now, in order.
      ready = true;
      for (const payload of pending.splice(0)) ws.send(JSON.stringify(payload));
      handlers.onOpen();
    };

    ws.onmessage = async (ev: MessageEvent) => {
      const raw =
        typeof ev.data === "string"
          ? ev.data
          : await (ev.data as Blob).text().catch(() => "");
      if (!raw) return;
      try {
        handlers.onFrame(JSON.parse(raw) as LiveServerFrame);
      } catch {
        handlers.onError("Vertex sent a frame that was not JSON.", raw.slice(0, 200));
      }
    };

    /**
     * ⚠ A socket failure is reported through the CLOSE, not through the error.
     *
     * The `error` event carries no detail whatsoever — no code, no message. The
     * `close` that always follows it carries both, and the reason IS the
     * diagnosis: `1007 · "Text output is not supported for native audio output
     * model"` is the difference between a one-line fix and an afternoon of
     * guessing.
     *
     * Reporting on `error` cost exactly that. The relay finished the session
     * the moment the error arrived, and the close a beat later — carrying the
     * real reason — was dropped as "already finished". Every distinct failure
     * came out as the same anonymous *"the upstream voice connection errored"*.
     *
     * So the error is only remembered here, and `close` does the reporting.
     */
    let errored = false;
    ws.onerror = () => {
      errored = true;
    };

    ws.onclose = (ev: CloseEvent) => {
      closed = true;
      if (errored || (ev.code !== 1000 && ev.code !== 1005)) {
        handlers.onError(
          `The upstream voice connection closed with ${ev.code}${
            ev.reason ? `: ${ev.reason}` : " and gave no reason"
          }.`,
          { code: ev.code, reason: ev.reason },
        );
        return;
      }
      handlers.onClose(ev.code, ev.reason);
    };

    const send = (payload: unknown) => {
      if (closed) return;
      if (!ready || ws.readyState !== 1) {
        // Bounded: a session that never opens is closed by the relay, and this
        // array goes with it. It exists for the handful of frames sent in the
        // first few hundred milliseconds, not as a buffer.
        if (pending.length < 32) pending.push(payload);
        return;
      }
      ws.send(JSON.stringify(payload));
    };

    return {
      get closed() {
        return closed;
      },
      sendAudio: (pcm) =>
        send({ realtimeInput: { mediaChunks: [{ mimeType: AUDIO_MIME, data: pcm.toString("base64") }] } }),
      sendToolResult: (results) =>
        send({
          toolResponse: {
            functionResponses: results.map((r) => ({ id: r.id, name: r.name, response: r.response })),
          },
        }),
      sendText: (text, opts) =>
        send({
          clientContent: {
            turns: [{ role: "user", parts: [{ text }] }],
            turnComplete: opts?.turnComplete ?? true,
          },
        }),
      close: (reason) => {
        if (closed) return;
        closed = true;
        try {
          ws.close(1000, reason.slice(0, 120));
        } catch {
          /* already gone */
        }
      },
    };
  }
}
