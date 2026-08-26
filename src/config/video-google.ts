import { env } from "./env";
import type { VideoMeeting, VideoProvider } from "./providers";

/**
 * Google Meet links, by way of the Calendar API.
 *
 * ── Why Calendar and not the Meet REST API ──────────────────────────────────
 *
 * `events.insert` with `conferenceData.createRequest` does three jobs in one
 * call: it returns the link, it puts the event on a calendar, and it **emails
 * the invitations**. The Meet REST API returns a bare link on nobody's calendar
 * and invites nobody. There is no mail transport anywhere in this codebase, and
 * this route is why none is needed.
 *
 * ── Why OAuth and not a service account ─────────────────────────────────────
 *
 * The consenting account is personal Gmail. A service account creating a Meet
 * link on somebody's behalf needs domain-wide delegation, which needs Google
 * Workspace. `docs/STATUS.md` claimed a service account would do, and following
 * that claim would have cost a day.
 *
 * The owner consented once; the refresh token is held server-side and exchanged
 * for an access token as needed. Users never see Google. The consequence to
 * accept: as far as Google is concerned every meeting is organised by that one
 * account. The application's own `organizer` field stays truthful.
 *
 * ── No SDK ──────────────────────────────────────────────────────────────────
 *
 * `googleapis` is **not a dependency of this project** and is not added here.
 * The house pattern (`VertexLlmProvider`) lazily `require()`s its SDK inside
 * the class so the test suite never pays to load it; two `fetch` calls against
 * documented REST endpoints satisfy that constraint outright — there is no
 * module to load, lazily or otherwise, and no new supply-chain surface.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Renew a little early — a token that expires mid-request is a flake. */
const EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface GoogleEvent {
  id?: string;
  hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
}

export class GoogleMeetVideoProvider implements VideoProvider {
  readonly id = "google";

  private cached?: CachedToken;
  private requestSeq = 0;

  /**
   * `fetchImpl` is injectable for the same reason `N1HttpClient` takes one: it
   * is how the request *shape* — the URL, `conferenceDataVersion=1`, the
   * `hangoutsMeet` key, the DELETE path — is asserted without a network call.
   *
   * **No test may reach Google.** `stub` is the default provider so a test that
   * forgets to opt in cannot, and the tests that do exercise this class hand it
   * a fake here.
   */
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * The three OAuth values, or a refusal naming which one is missing.
   *
   * ⚠ **This must fail loudly.** A missing or expired refresh token looks
   * exactly like a code bug from the inside, and it is the single most likely
   * thing to go wrong in production. The silent `catch` that turned a provider
   * failure into a linkless meeting was removed earlier in this phase and is
   * not coming back in through here.
   */
  private credentials(): {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  } {
    const e = env();
    const missing = [
      !e.googleOauthClientId && "GOOGLE_OAUTH_CLIENT_ID",
      !e.googleOauthClientSecret && "GOOGLE_OAUTH_CLIENT_SECRET",
      !e.googleOauthRefreshToken && "GOOGLE_OAUTH_REFRESH_TOKEN",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `Google Meet is selected (ORG_VIDEO_PROVIDER=google) but ${missing.join(
          ", ",
        )} ${missing.length === 1 ? "is" : "are"} not set.`,
      );
    }
    return {
      clientId: e.googleOauthClientId as string,
      clientSecret: e.googleOauthClientSecret as string,
      refreshToken: e.googleOauthRefreshToken as string,
    };
  }

  /** An access token, cached for its ~3600s life. */
  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
      return this.cached.token;
    }
    const { clientId, clientSecret, refreshToken } = this.credentials();
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      // Google answers a revoked or wrong refresh token with `invalid_grant`.
      // Naming it beats "request failed": one is a five-minute fix, the other
      // sends somebody looking through this file for a bug that is not here.
      throw new Error(
        `Could not exchange the Google refresh token (HTTP ${response.status}${
          body.error ? `, ${body.error}` : ""
        }${body.error_description ? `: ${body.error_description}` : ""}). ` +
          "The token may have been revoked or the OAuth client changed — re-consent and set GOOGLE_OAUTH_REFRESH_TOKEN again.",
      );
    }
    this.cached = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  /** Unique per call, as `createRequest` requires — a repeat returns the old link. */
  private nextRequestId(): string {
    this.requestSeq += 1;
    return `n1oms-${Date.now().toString(36)}-${this.requestSeq}`;
  }

  async createMeeting(input: {
    title: string;
    from?: string;
    to?: string;
    externals?: Array<{ email: string }>;
  }): Promise<VideoMeeting> {
    const token = await this.accessToken();
    // A meeting with no times should not be possible — `meeting.create.validate`
    // requires from/to — but an event Google will not accept is a worse failure
    // than an hour-long default.
    const start = input.from ?? new Date().toISOString();
    const end = input.to ?? new Date(Date.parse(start) + 60 * 60_000).toISOString();

    const url = new URL(EVENTS_URL);
    url.searchParams.set("conferenceDataVersion", "1");
    // Externals are real people with real inboxes: this is what makes Google
    // send them the invitation, which is the whole reason no EmailProvider is
    // needed for meetings.
    url.searchParams.set("sendUpdates", "all");

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: input.title,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: (input.externals ?? []).map((e) => ({ email: e.email })),
        conferenceData: {
          createRequest: {
            requestId: this.nextRequestId(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Google Calendar refused to create the meeting (HTTP ${response.status})${
          detail ? `: ${detail.slice(0, 400)}` : ""
        }`,
      );
    }
    const event = (await response.json()) as GoogleEvent;
    const link =
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
    if (!event.id || !link) {
      throw new Error(
        "Google Calendar created the event but returned no Meet link — conferenceDataVersion=1 may not have been honoured.",
      );
    }
    return {
      // ⚠ GOOGLE'S EVENT ID. `meeting.cancel` depends on this being the handle
      // the provider itself recognises; returning anything local puts the
      // discarded-id bug straight back.
      id: event.id,
      link,
      kind: "online",
    };
  }

  async cancelMeeting(id: string): Promise<void> {
    const token = await this.accessToken();
    const url = new URL(`${EVENTS_URL}/${encodeURIComponent(id)}`);
    url.searchParams.set("sendUpdates", "all");
    const response = await this.fetchImpl(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    // 410 Gone means somebody already deleted it — the desired state, not a
    // failure. 404 likewise: there is no event, so there is no live link.
    if (response.ok || response.status === 410 || response.status === 404) return;
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Google Calendar refused to delete the event (HTTP ${response.status})${
        detail ? `: ${detail.slice(0, 400)}` : ""
      }`,
    );
  }
}
