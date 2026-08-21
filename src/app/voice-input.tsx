"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useOperation } from "@/components/ops/use-operation";
import { inputCls } from "./ui/kit";

/**
 * Voice capture → read-back → a short completion form per intent.
 *
 * The transcript alone almost never carries every required field (dates, the
 * room, the recipients), so after the read-back we ask for exactly the fields
 * the operation's validate() would refuse without. Reference data (rooms,
 * equipment, people, who I am) comes from /api/voice-context, which reads
 * through the spine so it is already permission-filtered.
 */

type Intent = "leave" | "room" | "fault" | "announce";

interface VoiceContext {
  self: { id: string };
  rooms: Array<{ id: string; name: string }>;
  equipment: Array<{ id: string; name: string }>;
}

function detectIntent(transcript: string): Intent | null {
  const t = transcript.toLowerCase();
  if (t.includes("leave") || t.includes("day off")) return "leave";
  if (t.includes("room") || t.includes("hall") || t.includes("book")) return "room";
  if (t.includes("fault") || t.includes("broken") || t.includes("projector")) return "fault";
  if (t.includes("announce") || t.includes("remind")) return "announce";
  return null;
}

const INTENT_LABEL: Record<Intent, string> = {
  leave: "Request leave",
  room: "Book a room",
  fault: "Report a fault",
  announce: "Post to Everyone",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function VoiceButton() {
  const op = useOperation();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [ctx, setCtx] = useState<VoiceContext | null>(null);
  const [ctxError, setCtxError] = useState(false);
  const busy = op.busy;
  const recognitionRef = useRef<unknown>(null);

  const intent = transcript ? detectIntent(transcript) : null;

  // Per-intent form state, seeded when a transcript arrives.
  const [leaveForm, setLeaveForm] = useState({ fromDate: "", toDate: "" });
  const [roomForm, setRoomForm] = useState({ roomId: "", date: "", from: "09:00", to: "10:00", title: "" });
  const [faultForm, setFaultForm] = useState({ equipmentId: "", fault: "" });
  const [announceForm, setAnnounceForm] = useState({ message: "" });
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Seed every intent form the moment a transcript lands (not in an effect —
  // this runs once per capture, inside the recognition callback).
  const seedForms = useCallback((text: string) => {
    // Light hints from the words themselves; the form lets the user correct.
    const tomorrow = /tomorrow/i.test(text);
    const base = new Date();
    if (tomorrow) base.setDate(base.getDate() + 1);
    const day = isoDate(base);
    setLeaveForm({ fromDate: day, toDate: day });
    setRoomForm({ roomId: "", date: day, from: "09:00", to: "10:00", title: text });
    setFaultForm({ equipmentId: "", fault: text });
    setAnnounceForm({ message: text });
  }, []);

  useEffect(() => {
    if (!transcript || ctx) return;
    fetch("/api/voice-context")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setCtx(d as VoiceContext))
      .catch(() => setCtxError(true));
  }, [transcript, ctx]);

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
      seedForms(text);
      setTranscript(text);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    setTranscript(null);
    setResult(null);
    rec.start();
  }, [seedForms]);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current as { stop?: () => void } | null;
    rec?.stop?.();
    setListening(false);
  }, []);

  function argsFor(): { name: string; args: Record<string, unknown> } | null {
    if (!intent || !ctx) return null;
    switch (intent) {
      case "leave":
        if (!leaveForm.fromDate || !leaveForm.toDate) return null;
        return {
          name: "leave.request",
          args: { employeeId: ctx.self.id, fromDate: leaveForm.fromDate, toDate: leaveForm.toDate },
        };
      case "room":
        if (!roomForm.roomId || !roomForm.date || !roomForm.from || !roomForm.to) return null;
        return {
          name: "room.book",
          args: {
            roomId: roomForm.roomId,
            title: roomForm.title || "Booked by voice",
            from: `${roomForm.date}T${roomForm.from}:00`,
            to: `${roomForm.date}T${roomForm.to}:00`,
          },
        };
      case "fault":
        if (!faultForm.equipmentId || !faultForm.fault.trim()) return null;
        return {
          name: "equipment.reportFault",
          args: { equipmentId: faultForm.equipmentId, fault: faultForm.fault.trim() },
        };
      case "announce":
        // Posting to Everyone goes to the chat, not through an operation.
        return null;
    }
  }

  const ready =
    intent === "announce" ? announceForm.message.trim().length > 0 : Boolean(argsFor());

  async function save() {
    if (!transcript || !ready) return;

    if (intent === "announce") {
      // Announcements were replaced by chat — "announce X" posts X in the
      // Everyone group.
      setSendError(null);
      setSending(true);
      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation: "group:everyone", text: announceForm.message.trim() }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setSendError(data.error ?? "Couldn't post — try again.");
          return;
        }
        setTranscript(null);
        setResult("Posted to Everyone.");
      } catch {
        setSendError("Couldn't reach the server — try again.");
      } finally {
        setSending(false);
      }
      return;
    }

    const opCall = argsFor();
    if (!opCall) return;
    const outcome = await op.run(opCall.name, opCall.args, {
      start: "voice",
      extra: { transcript },
      refresh: false,
    });
    if (outcome.status === "ran") {
      setTranscript(null);
      setResult("Done.");
      op.reset();
    } else if (outcome.status === "awaiting-confirmation") {
      setTranscript(null);
      setResult("Saved — it needs confirmation.");
      op.reset();
    }
    // Refused or rejected: keep the form open — op.error renders inline so the
    // user can fix the details instead of losing them.
  }

  function cancel() {
    setTranscript(null);
    setResult("Nothing is saved.");
    setSendError(null);
    op.reset();
  }

  const labelCls = "text-[10px] font-semibold uppercase tracking-widest text-ink-faint";

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
            <div className={labelCls}>Read-back</div>
            <p className="mt-2 text-lg italic text-accent-strong">&ldquo;{transcript}&rdquo;</p>

            {!intent ? (
              <p className="mt-3 text-sm text-ink-soft">
                I didn&apos;t catch what you meant — try rephrasing or cancel and use a form.
              </p>
            ) : ctxError ? (
              <p className="mt-3 text-sm text-danger">Couldn&apos;t load the details needed — cancel and use a form.</p>
            ) : !ctx ? (
              <p className="mt-3 text-sm text-ink-faint">Loading details…</p>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{INTENT_LABEL[intent]}</span> — fill in the rest:
                </p>

                {intent === "leave" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div>
                      <div className={labelCls}>From</div>
                      <input type="date" value={leaveForm.fromDate} onChange={(e) => setLeaveForm({ ...leaveForm, fromDate: e.target.value })} className={`${inputCls} mt-1`} />
                    </div>
                    <div>
                      <div className={labelCls}>To</div>
                      <input type="date" value={leaveForm.toDate} onChange={(e) => setLeaveForm({ ...leaveForm, toDate: e.target.value })} className={`${inputCls} mt-1`} />
                    </div>
                  </div>
                )}

                {intent === "room" && (
                  <div className="space-y-2">
                    <select value={roomForm.roomId} onChange={(e) => setRoomForm({ ...roomForm, roomId: e.target.value })} className={`${inputCls} w-full`}>
                      <option value="">Choose a room…</option>
                      {ctx.rooms.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="date" value={roomForm.date} onChange={(e) => setRoomForm({ ...roomForm, date: e.target.value })} className={inputCls} />
                      <input type="time" value={roomForm.from} onChange={(e) => setRoomForm({ ...roomForm, from: e.target.value })} className={inputCls} />
                      <span className="text-xs text-ink-faint">to</span>
                      <input type="time" value={roomForm.to} onChange={(e) => setRoomForm({ ...roomForm, to: e.target.value })} className={inputCls} />
                    </div>
                  </div>
                )}

                {intent === "fault" && (
                  <div className="space-y-2">
                    <select value={faultForm.equipmentId} onChange={(e) => setFaultForm({ ...faultForm, equipmentId: e.target.value })} className={`${inputCls} w-full`}>
                      <option value="">Which equipment?</option>
                      {ctx.equipment.map((eq) => (
                        <option key={eq.id} value={eq.id}>{eq.name}</option>
                      ))}
                    </select>
                    <input value={faultForm.fault} onChange={(e) => setFaultForm({ ...faultForm, fault: e.target.value })} placeholder="What's wrong?" className={`${inputCls} w-full`} />
                  </div>
                )}

                {intent === "announce" && (
                  <div className="space-y-2">
                    <textarea value={announceForm.message} onChange={(e) => setAnnounceForm({ message: e.target.value })} rows={2} className={`${inputCls} w-full`} />
                    <p className="text-[11px] text-ink-faint">Posts in the Everyone chat — the whole organisation sees it.</p>
                  </div>
                )}
              </div>
            )}

            {(op.error ?? sendError) && (
              <p role="alert" className="shake mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                {op.error ?? sendError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={cancel}
                className="press rounded-full bg-raised px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!ready || busy || sending}
                className="press rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
              >
                {busy || sending ? "Saving…" : "Save"}
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
