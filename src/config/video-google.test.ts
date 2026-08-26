import { describe, it, expect, afterEach } from "vitest";
import { GoogleMeetVideoProvider } from "./video-google";
import { providerModes, providers, resetProviders } from "./providers";
import { env, resetEnvCache } from "./env";

/**
 * The Google provider, entirely offline.
 *
 * **No test here reaches Google.** The class takes an injectable `fetchImpl`
 * for exactly this reason — the same seam `N1HttpClient` uses — and a fake is
 * handed in every time. If any of these ever made a real request it would be
 * visible immediately: the fake records every call and the assertions are
 * against what it recorded.
 */

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown; headers: unknown }> = [];
  let i = 0;
  const impl: typeof fetch = async (url, init) => {
    const raw = init?.body;
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body:
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw instanceof URLSearchParams
            ? Object.fromEntries(raw)
            : raw,
      headers: init?.headers,
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { impl, calls };
}

const TOKEN_OK = { status: 200, body: { access_token: "at_1", expires_in: 3599 } };

function withCredentials(fn: () => Promise<void> | void) {
  return async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csec";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "rtok";
    resetEnvCache();
    await fn();
  };
}

afterEach(() => {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  delete process.env.ORG_VIDEO_PROVIDER;
  resetEnvCache();
  resetProviders();
});

describe("GoogleMeetVideoProvider — createMeeting", () => {
  it(
    "asks Calendar for a hangoutsMeet conference and returns GOOGLE's event id",
    withCredentials(async () => {
      const { impl, calls } = fakeFetch([
        TOKEN_OK,
        {
          status: 200,
          body: {
            id: "goog_event_123",
            hangoutLink: "https://meet.google.com/abc-defg-hij",
            conferenceData: { conferenceId: "abc-defg-hij" },
          },
        },
      ]);
      const provider = new GoogleMeetVideoProvider(impl);
      const meeting = await provider.createMeeting({
        title: "Course review",
        from: "2026-09-10T15:00:00Z",
        to: "2026-09-10T16:00:00Z",
        externals: [{ email: "outside@example.com" }],
      });

      // The token exchange first, then the event.
      expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
      expect(calls[0].body).toMatchObject({ grant_type: "refresh_token", refresh_token: "rtok" });

      const create = calls[1];
      expect(create.method).toBe("POST");
      expect(create.url).toContain("/calendar/v3/calendars/primary/events");
      // Without conferenceDataVersion=1 Google silently returns an event with
      // no Meet link at all — the single easiest thing to get wrong here.
      expect(create.url).toContain("conferenceDataVersion=1");
      // Without sendUpdates=all the external gets no invitation email, and
      // this codebase has no other way to send them one.
      expect(create.url).toContain("sendUpdates=all");
      expect(create.body).toMatchObject({
        summary: "Course review",
        start: { dateTime: "2026-09-10T15:00:00Z" },
        end: { dateTime: "2026-09-10T16:00:00Z" },
        attendees: [{ email: "outside@example.com" }],
        conferenceData: {
          createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      });
      expect(
        (create.body as { conferenceData: { createRequest: { requestId: string } } })
          .conferenceData.createRequest.requestId,
      ).toBeTruthy();

      // ⚠ The id `meeting.cancel` will hand back to Google.
      expect(meeting.id).toBe("goog_event_123");
      expect(meeting.link).toBe("https://meet.google.com/abc-defg-hij");
    }),
  );

  it(
    "caches the access token rather than exchanging it per call",
    withCredentials(async () => {
      const { impl, calls } = fakeFetch([
        TOKEN_OK,
        { status: 200, body: { id: "e1", hangoutLink: "https://meet.google.com/a" } },
        { status: 200, body: { id: "e2", hangoutLink: "https://meet.google.com/b" } },
      ]);
      const provider = new GoogleMeetVideoProvider(impl);
      await provider.createMeeting({ title: "One" });
      await provider.createMeeting({ title: "Two" });
      expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    }),
  );

  it(
    "refuses when the event comes back with no Meet link",
    withCredentials(async () => {
      const { impl } = fakeFetch([TOKEN_OK, { status: 200, body: { id: "e1" } }]);
      const provider = new GoogleMeetVideoProvider(impl);
      await expect(provider.createMeeting({ title: "One" })).rejects.toThrow(/no Meet link/i);
    }),
  );
});

describe("GoogleMeetVideoProvider — failing loudly", () => {
  it(
    "names a revoked refresh token instead of reporting a generic failure",
    withCredentials(async () => {
      const { impl } = fakeFetch([
        { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
      ]);
      const provider = new GoogleMeetVideoProvider(impl);
      // The single most likely production failure, and from the inside it looks
      // exactly like a code bug unless the message says otherwise.
      await expect(provider.createMeeting({ title: "One" })).rejects.toThrow(/invalid_grant/);
      await expect(provider.createMeeting({ title: "One" })).rejects.toThrow(
        /GOOGLE_OAUTH_REFRESH_TOKEN/,
      );
    }),
  );

  it("names which credential is missing, and never calls out", async () => {
    resetEnvCache();
    const { impl, calls } = fakeFetch([TOKEN_OK]);
    const provider = new GoogleMeetVideoProvider(impl);
    await expect(provider.createMeeting({ title: "One" })).rejects.toThrow(
      /GOOGLE_OAUTH_CLIENT_ID/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("GoogleMeetVideoProvider — cancelMeeting", () => {
  it(
    "deletes the event by GOOGLE's id",
    withCredentials(async () => {
      // 200 rather than 204: the fake serialises a JSON body, and `Response`
      // refuses a body on a 204. Google answers 204; what is under test here is
      // the URL and the verb, and both are the same either way.
      const { impl, calls } = fakeFetch([TOKEN_OK, { status: 200, body: {} }]);
      const provider = new GoogleMeetVideoProvider(impl);
      await provider.cancelMeeting("goog_event_123");
      const del = calls[1];
      expect(del.method).toBe("DELETE");
      expect(del.url).toContain("/events/goog_event_123");
    }),
  );

  it(
    "treats an already-deleted event as done, not as a failure",
    withCredentials(async () => {
      const { impl } = fakeFetch([TOKEN_OK, { status: 410, body: {} }]);
      const provider = new GoogleMeetVideoProvider(impl);
      // 410 Gone is the desired state reached by another route. Throwing here
      // would make `meeting.cancel` report a live link that does not exist.
      await expect(provider.cancelMeeting("gone")).resolves.toBeUndefined();
    }),
  );

  it(
    "throws on a refusal, so a live link is never reported as ended",
    withCredentials(async () => {
      const { impl } = fakeFetch([TOKEN_OK, { status: 403, body: { error: "forbidden" } }]);
      const provider = new GoogleMeetVideoProvider(impl);
      await expect(provider.cancelMeeting("e1")).rejects.toThrow(/403/);
    }),
  );
});

describe("ORG_VIDEO_PROVIDER selects it", () => {
  it("stub by default — no test can reach Google by forgetting", () => {
    resetEnvCache();
    resetProviders();
    expect(env().videoProvider).toBe("stub");
    expect(providers().video.id).toBe("stub");
    expect(providerModes().video).toEqual({ id: "stub", mode: "stub" });
  });

  it("google when asked, and /admin and /api/health then read 'live'", () => {
    process.env.ORG_VIDEO_PROVIDER = "google";
    resetEnvCache();
    resetProviders();
    expect(providers().video.id).toBe("google");
    // providerModes() is the ONE source of truth for this question — it reads
    // the constructed provider's id. `videoMode()` read the env var instead,
    // had no callers, and was deleted in this phase.
    expect(providerModes().video).toEqual({ id: "google", mode: "live" });
  });
});
