"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [sharedRoom, setSharedRoom] = useState(false);
  const [busy, setBusy] = useState(false);
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
    const op = interpret(transcript);
    if (!op) {
      setResult("I didn't catch what you meant — try rephrasing or use a form.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "voice", name: op.name, args: op.args, transcript }),
    });
    const data = await res.json();
    setBusy(false);
    setTranscript(null);
    if (data.status === "ran") setResult("Done.");
    else if (data.status === "awaiting-confirmation") setResult("Saved — it needs confirmation.");
    else if (data.status === "forbidden") setResult("That action is not available.");
    else if (data.status === "rejected") setResult(`Missing: ${(data.missing ?? []).join(", ")}`);
    else setResult("Could not save.");
    router.refresh();
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
        className={`fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full text-2xl text-white shadow-lg transition-colors ${
          listening ? "animate-pulse bg-rose-600" : "bg-teal-700"
        }`}
        aria-label="Hold to speak"
      >
        ✦
      </button>

      {listening && (
        <div className="fixed bottom-24 right-6 z-40 rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          Listening — just say it
        </div>
      )}

      {transcript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-zinc-950">
            <div className="text-xs font-medium uppercase tracking-widest text-zinc-400">Read-back</div>
            <p className="mt-2 font-serif text-lg italic text-amber-600">&ldquo;{transcript}&rdquo;</p>
            {interpreted ? (
              <p className="mt-3 text-sm text-black dark:text-zinc-100">
                Interpreted as: <span className="font-medium">{interpreted.label}</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">
                I didn&apos;t catch what you meant — try rephrasing or cancel and use a form.
              </p>
            )}
            <label className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
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
                className="rounded-lg border border-black/[.12] px-4 py-2 text-sm font-medium text-zinc-600 dark:border-white/[.2] dark:text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!interpreted || busy}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && !transcript && (
        <div className="fixed bottom-24 right-6 z-40 max-w-xs rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {result}
          <button
            onClick={() => setResult(null)}
            className="ml-2 text-xs text-zinc-400 underline"
          >
            dismiss
          </button>
        </div>
      )}
    </>
  );
}
