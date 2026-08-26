/**
 * Playing what it says, without seams.
 *
 * ── ⚠ WHY A SCHEDULER AND NOT "PLAY EACH CHUNK AS IT ARRIVES" ───────────────
 *
 * Audio comes down in chunks of a few hundred milliseconds. Calling `start()`
 * on each one as it arrives puts an audible gap between them — the browser
 * begins playback at the next event-loop opportunity, not at the sample the
 * previous chunk ended on, and the result is a voice that clicks between every
 * phrase.
 *
 * So each buffer is scheduled at the exact time the last one ends, using the
 * AudioContext's own clock. `cursor` is that time. When the queue has drained
 * and a new chunk arrives late, the cursor is pulled forward to *now* plus a
 * small lead — otherwise it would try to schedule in the past, and everything
 * queued after it would race.
 *
 * ── ⚠ BARGE-IN: STOP, DO NOT FADE ───────────────────────────────────────────
 *
 * Audio that keeps playing after somebody has interrupted is the single most
 * irritating failure this interface can have. `stop()` kills every scheduled
 * source immediately and drops what is queued. No fade, no "finish the current
 * chunk" — those are both worse, because the person is already talking.
 */

/** A tiny lead, so the first chunk after a gap is not scheduled in the past. */
const LEAD_SECONDS = 0.05;

export interface Playback {
  /** Queue one chunk of 16-bit signed PCM at the model's output rate. */
  push(pcm: ArrayBuffer): void;
  /** Interrupted. Stop now and drop everything queued. */
  stop(): void;
  /** True while there is audio scheduled that has not finished. */
  readonly speaking: boolean;
  close(): void;
}

export function createPlayback(ctx: AudioContext, sampleRate: number): Playback {
  let cursor = 0;
  let live: AudioBufferSourceNode[] = [];

  const prune = () => {
    live = live.filter((s) => (s as unknown as { __done?: boolean }).__done !== true);
  };

  return {
    push(pcm: ArrayBuffer) {
      const samples = new Int16Array(pcm);
      if (!samples.length) return;

      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) {
        // 0x8000 for the negative side: Int16 is asymmetric, and dividing both
        // sides by 0x7fff makes the loudest negative sample clip.
        channel[i] = samples[i] < 0 ? samples[i] / 0x8000 : samples[i] / 0x7fff;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      if (cursor < now + LEAD_SECONDS) cursor = now + LEAD_SECONDS;
      source.start(cursor);
      cursor += buffer.duration;

      source.onended = () => {
        (source as unknown as { __done?: boolean }).__done = true;
        prune();
      };
      live.push(source);
    },

    stop() {
      for (const source of live) {
        try {
          source.onended = null;
          source.stop();
        } catch {
          // Already finished, or never started. Both are fine — the point is
          // that nothing is left playing.
        }
      }
      live = [];
      cursor = 0;
    },

    get speaking() {
      prune();
      return live.length > 0;
    },

    close() {
      this.stop();
      void ctx.close();
    },
  };
}
