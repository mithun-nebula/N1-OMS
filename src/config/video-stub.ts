import type { VideoMeeting, VideoProvider } from "./providers";

/**
 * The inert video provider — and the fake the suite runs against.
 *
 * Same role `llm-fake.ts` plays for the model: `stub` stays the default so a
 * test that forgets to opt in cannot reach the network, and the calls it
 * receives are recorded so a test can assert **what the provider was asked to
 * do**, not merely that nothing threw.
 *
 * That recording is not decoration. `cancelMeeting` was an empty method for as
 * long as it existed, which meant `meeting.cancel` could pass it a local
 * `link_meeting_…` id — a value no real provider has ever seen — and the suite
 * stayed green. The stub's silence *was* the bug's hiding place.
 *
 * Follows the in-file fake convention already here (`FakePersistence` in
 * `assistant.test.ts`, `FakeDays` in `durability.test.ts`). No `vi.mock`.
 */

export interface StubVideoCall {
  op: "create" | "cancel";
  /** The title on a create; the id the caller passed on a cancel. */
  arg: string;
}

let calls: StubVideoCall[] = [];

/** Every call the stub has taken since the last reset. */
export function stubVideoCalls(): StubVideoCall[] {
  return calls;
}

export function resetStubVideo(): void {
  calls = [];
}

let seq = 0;

export class StubVideoProvider implements VideoProvider {
  readonly id = "stub";

  async createMeeting(input: { title: string }): Promise<VideoMeeting> {
    calls.push({ op: "create", arg: input.title });
    seq += 1;
    return {
      // A provider's own id, deliberately unlike anything this codebase would
      // generate for itself — so a test that passes the wrong id fails loudly
      // rather than coincidentally matching.
      id: `stub-event-${seq}`,
      link: `https://meet.example/${encodeURIComponent(input.title)}`,
      kind: "online",
    };
  }

  async cancelMeeting(id: string): Promise<void> {
    calls.push({ op: "cancel", arg: id });
  }
}
