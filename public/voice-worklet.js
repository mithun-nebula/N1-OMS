/**
 * Microphone capture, off the main thread.
 *
 * ── ⚠ WHY A WORKLET AND NOT `MediaRecorder`, AND NOT `ScriptProcessorNode` ──
 *
 * `MediaRecorder` is the obvious API and the wrong one: it produces webm/opus
 * *containers*, and the live model wants raw PCM frames. There is no option to
 * make it emit them.
 *
 * `ScriptProcessorNode` would produce the right samples and is deprecated, and
 * — the part that actually matters — it runs on the **main thread**. It glitches
 * every time React renders, which for a component showing a live transcript is
 * constantly. An AudioWorklet runs on the audio thread and does not care what
 * the UI is doing.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 * Float32 in, 16-bit signed PCM out, resampled to the rate the model reads.
 *
 * ⚠ **The resample is not optional.** Vertex ignores the `rate=` label on the
 * way up and reads whatever arrives as 16 kHz — the same clip declared at 16000
 * and at 24000 billed identically. So sending 48 kHz samples labelled 48000
 * does not produce an error; it produces speech played at three times the
 * speed, which is the kind of bug that eats an afternoon.
 *
 * This file is served rather than bundled: `audioWorklet.addModule` takes a URL
 * and the module runs in its own realm, so it cannot be an import.
 */

const TARGET_RATE = 16000;

/** ~100ms of audio per message. Small enough to be responsive, large enough not to thrash. */
const FRAME_SAMPLES = 1600;

class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    // `sampleRate` is a global in the worklet scope: the AudioContext's real
    // rate, which is the hardware's and is usually 44100 or 48000.
    this.ratio = sampleRate / TARGET_RATE;
    this.position = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    // Linear interpolation. Not a windowed sinc — for speech at this ratio the
    // difference is inaudible, and the recogniser's own front end resamples
    // again anyway. What matters is that the RATE is right.
    while (this.position < channel.length) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      const a = channel[index];
      const b = index + 1 < channel.length ? channel[index + 1] : a;
      const sample = a + (b - a) * frac;

      // Clamp before scaling: a sample above 1.0 wraps to a loud negative
      // number in 16-bit, which sounds like a crack rather than like clipping.
      const clamped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      if (this.filled === FRAME_SAMPLES) {
        // Transferred, not copied — the buffer is handed over and replaced.
        const out = this.buffer;
        this.port.postMessage(out.buffer, [out.buffer]);
        this.buffer = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }
      this.position += this.ratio;
    }
    // Carry the fractional remainder into the next block, or every block
    // boundary introduces a click.
    this.position -= channel.length;
    return true;
  }
}

registerProcessor("mic-capture", MicCapture);
