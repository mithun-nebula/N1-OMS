import type { ActorId } from "@/spine/operation/types";

/**
 * Who may have the join link.
 *
 * Meetings deliberately carry no RBAC — everyone can see that a meeting exists,
 * which is what makes the shared calendar useful. **The link is different.** It
 * is not a description of the meeting, it is the way into the room, and anybody
 * holding it can walk in whether or not they were invited.
 *
 * So the record stays open and the link travels only with the people on it.
 * There is no separate permission rule for this because there is no separate
 * decision: you were invited, or you were not.
 *
 * Applied at every surface that reads a meeting rather than at one of them —
 * `/meetings`, the dashboard, and `list_meetings` / `get_meeting`, which is the
 * door chat and voice come through. A rule enforced on two screens out of three
 * is not a rule.
 */
export function isInTheMeeting(
  actor: ActorId,
  meeting: { organizer?: unknown; attendees?: unknown },
): boolean {
  if (meeting.organizer === actor) return true;
  const attendees = meeting.attendees;
  return Array.isArray(attendees) && attendees.includes(actor);
}

/**
 * The meeting as this person may see it: everything, minus the link when they
 * are not on it.
 *
 * Returns a NEW object with `link` removed rather than blanked. A blanked field
 * still says "there is a link here and it is being kept from you", and the
 * point is that somebody not in the meeting has no business knowing either way.
 */
export function withLinkFor<T extends { organizer?: unknown; attendees?: unknown; link?: unknown }>(
  actor: ActorId,
  meeting: T,
): Omit<T, "link"> & { link?: T["link"] } {
  if (isInTheMeeting(actor, meeting)) return meeting;
  const { link: _dropped, ...rest } = meeting;
  return rest;
}
