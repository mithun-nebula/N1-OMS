"use client";

import { useState, useRef, useCallback } from "react";
import { useOperation } from "@/components/ops/use-operation";

interface InterpretedOp {
  name: string;
  label: string;
  args: Record<string, unknown>;
}

function interpret(transcript: string): InterpretedOp | null {
  const t = transcript.toLowerCase();
  if (t.includes("leave") || t.includes("day off"))
    return { name: "leave.request", label: "Request leave", args: { employeeId: "", fromDate: "", toDate: "" } };
  if (t.includes("room") || t.includes("hall") || t.includes("book"))
    return { name: "room.book", label: "Book a room", args: { title: transcript, from: "", to: "" } };
  if (t.includes("fault") || t.includes("broken") || t.includes("projector"))
    return { name: "equipment.reportFault", label: "Report a fault", args: { equipmentId: "", fault: transcript } };
  if (t.includes("announce") || t.includes("remind"))
    return { name: "announcement.send", label: "Send an announcement", args: { message: transcript, to: [] } };
  return null;
}

export function VoiceButton() {
  const op = useOperation();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [sharedRoom, setSharedRoom] = useState(false);
  const busy = op.busy;
  const recognitionRef = useRef<unknown>(null);

  const startListening = useCallback(() => {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) {
      setResult("Voice input is not available in this browser. Try Chrome or Edge.");
      return;
    }
    const rec = new SR() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    setTranscript(null);
    setResult(null);
    rec.start();
  }, []);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current as { stop?: () => void } | null;
    rec?.stop?.();
    setListening(false);
  }, []);

  async function save() {
    if (!transcript) return;
    const interpretedOp = interpret(transcript);
    if (!interpretedOp) {
      setResult("I didn't catch what you meant — try rephrasing or use a form.");
      return;
    }
    const outcome = await op.run(interpretedOp.name, interpretedOp.args, {
      start: "voice",
      extra: { transcript },
    });
    setTranscript(null);
    if (outcome.status === "ran") setResult("Done.");
    else if (outcome.status === "awaiting-confirmation") setResult("Saved — it needs confirmation.");
    else if (outcome.status === "forbidden") setResult(op.error ?? "That action is not available.");
    else if (outcome.status === "rejected") setResult(op.error ?? "Some details are missing.");
    else setResult("Could not save. Nothing was changed.");
    op.reset();
  }

  function cancel() {
    setTranscript(null);
    setResult("Nothing is saved.");
  }

  const interpreted = transcript ? interpret(transcript) : null;

  return (
    <>
      <button
        onClick={listening ? stopListening : startListening}
        className={`press fixed bottom-20 right-4 z-40 h-12 w-12 rounded-full text-xl text-chrome-ink shadow-lift transition-colors md:bottom-6 md:right-6 md:h-14 md:w-14 md:text-2xl ${
          listening ? "animate-pulse bg-danger" : "bg-chrome-card hover:bg-chrome"
        }`}
        aria-label="Hold to speak"
      >
        ✦
      </button>

      {listening && (
        <div className="sheet-up fixed bottom-36 right-4 z-40 rounded-2xl border-l-[3px] border-accent-strong bg-chrome px-4 py-2 text-sm text-chrome-ink shadow-lift md:bottom-24 md:right-6">
          Listening — just say it
        </div>
      )}

      {transcript && (
        <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-chrome-deep/60 p-4 backdrop-blur-sm">
          <div className="pop-in w-full max-w-md rounded-3xl bg-surface p-6 shadow-lift">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Read-back</div>
            <p className="mt-2 text-lg italic text-accent-strong">&ldquo;{transcript}&rdquo;</p>
            {interpreted ? (
              <p className="mt-3 text-sm text-ink">
                Interpreted as: <span className="font-semibold">{interpreted.label}</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                I didn&apos;t catch what you meant — try rephrasing or cancel and use a form.
              </p>
            )}
            <label className="mt-4 flex items-center gap-2 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={sharedRoom}
                onChange={(e) => setSharedRoom(e.target.checked)}
                className="h-4 w-4"
              />
              This is a shared room — restricted details won&apos;t be read aloud
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={cancel}
                className="press rounded-full bg-raised px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!interpreted || busy}
                className="press rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && !transcript && (
        <div className="sheet-up fixed bottom-36 right-4 z-40 max-w-xs rounded-2xl bg-chrome px-4 py-2.5 text-sm text-chrome-ink shadow-lift md:bottom-24 md:right-6">
          {result}
          <button
            onClick={() => setResult(null)}
            className="press ml-2 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-white/20"
          >
            OK
          </button>
        </div>
      )}
    </>
  );
}
