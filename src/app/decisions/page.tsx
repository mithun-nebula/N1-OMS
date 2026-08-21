import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isManagerOrAbove } from "@/server/roles";
import { Shell } from "../shell";
import { DecisionsClient } from "./decisions-client";

export default async function DecisionsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();
  const spine = await getSpine();

  const decisions = (await deps.graph
    .find("org-memory", () => true))
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      return {
        id: n.id,
        title: String(d.title ?? n.id),
        decision: String(d.decision ?? ""),
        reason: String(d.reasonAtTime ?? ""),
        decidedBy: String(d.decidedBy ?? ""),
        decidedAt: String(d.decidedAt ?? ""),
        linkedRecords: Array.isArray(d.linkedRecords) ? (d.linkedRecords as Array<{ nodeType: string; nodeId: string }>) : [],
      };
    })
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));

  // Decisions captured against a meeting. Read through the spine so the
  // permission rule for `meeting-decision` (view for every role) decides what
  // this actor sees, with field filtering applied.
  const decisionSets = await spine.readMany({
    actor: user.id,
    nodeType: "meeting-decision",
  });

  const meetingTitles = new Map(
    (await deps.graph.find("meeting", () => true)).map((n) => [
      n.id,
      (n.data as { title?: string }).title ?? n.id,
    ]),
  );

  const nameOf = (id?: string) => (id ? directory().nameOf(id) : undefined);

  const meetingDecisions = decisionSets
    .map(({ record }) => {
      const d = record as {
        meetingId?: string;
        decisions?: Array<{ id: string; text: string; owner?: string }>;
        actions?: Array<{ id: string; text: string; owner: string; due?: string; done?: boolean }>;
      };
      const meetingId = String(d.meetingId ?? "");
      return {
        meetingId,
        meetingTitle: meetingTitles.get(meetingId) ?? meetingId,
        decisions: (d.decisions ?? []).map((dec) => ({
          id: dec.id,
          text: dec.text,
          ownerName: nameOf(dec.owner),
        })),
        actions: (d.actions ?? []).map((a) => ({
          id: a.id,
          text: a.text,
          ownerName: nameOf(a.owner) ?? a.owner,
          due: a.due,
          done: a.done === true,
        })),
      };
    })
    .filter((s) => s.meetingId && s.decisions.length + s.actions.length > 0);

  const canRecord = isManagerOrAbove(user.role);

  return (
    <Shell>
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
            Decision <span className="font-extrabold">log</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Decisions remembered with the reason given at the time.
          </p>
        </div>
      </header>
      <DecisionsClient decisions={decisions} meetingDecisions={meetingDecisions} canRecord={canRecord} />
    </Shell>
  );
}
