import { z } from "zod";
import { CONFIRMATION_FIELD, type WriteToolSpec } from "./build";

/**
 * Meetings, the calendar, rooms, events, facilities and documents.
 *
 * ── The confusions this file exists to prevent ──────────────────────────────
 *
 * The write catalogue creates a kind of confusion the read catalogue never had.
 * A wrong read tool wastes a turn; a wrong write tool **cancels the wrong
 * thing**, and `cancel_meeting` notifies everybody invited.
 *
 * Four pairs live in here, and every one of them is reachable from a single
 * ordinary sentence:
 *
 *   cancel_meeting / cancel_calendar_entry   "cancel Tuesday"
 *   cancel_room_booking / cancel_meeting     "we don't need Hall 2"
 *   create_meeting / create_calendar_entry   "put the review in for Thursday"
 *   close_event / delete_course              "we're done with that"
 *
 * Each gets the both-directions treatment: the negative clause names the
 * sibling, and the sibling's negative clause names it back.
 */

export const workplaceWriteTools: WriteToolSpec[] = [
  // ── meetings ─────────────────────────────────────────────────────────────
  {
    operation: "meeting.create",
    tool: "create_meeting",
    tier: "straight",
    not: "This tool does NOT put a plain entry on the shared calendar — that is create_calendar_entry, which has no attendees, no room and no join link. Use THIS when people are meeting each other; use that one for a deadline, a holiday or a note in the diary.",
    does: "Arrange a meeting: time, people, and a room and/or a join link.",
    use: 'Use for "set up a review with Priya and Arun on Thursday at 3", "book a call with the course team".',
    notes: [
      'kind is one of "both" (a room AND a link — the default and usually right), "online" (a link only), "in-person" (a room only).',
      "An in-person or both meeting books a room automatically — do not book one separately.",
      "People outside the organisation go in externals, by email. Google sends them the invitation.",
    ],
    args: z.object({
      title: z.string().describe("What the meeting is, in their words."),
      kind: z
        .enum(["both", "online", "in-person"])
        .describe('Default to "both" unless they said otherwise.'),
      from: z.string().describe("Start, as an ISO timestamp."),
      to: z.string().describe("End, as an ISO timestamp."),
      attendees: z.array(z.string()).describe("Employee ids, from find_people."),
      roomId: z.string().optional().describe("Only if they named a room. Otherwise one is chosen."),
      externals: z
        .array(z.object({ email: z.string() }))
        .optional()
        .describe("People outside the organisation."),
    }),
    requires: { action: "view", nodeType: "meeting" },
  },
  {
    operation: "meeting.update",
    tool: "update_meeting",
    tier: "straight",
    not: "This tool does NOT edit a calendar entry — that is edit_calendar_entry. It also cannot add or remove people; use add_meeting_attendee for that.",
    does: "Move or rename a meeting. The join link never changes.",
    use: 'Use for "move the review to 4", "rename Thursday\'s call".',
    notes: ["The room booking moves with it. Everybody invited is told what changed."],
    args: z.object({
      meetingId: z.string().describe("From list_meetings."),
      title: z.string().optional(),
      from: z.string().optional().describe("New start, ISO."),
      to: z.string().optional().describe("New end, ISO."),
    }),
    requires: { action: "view", nodeType: "meeting" },
  },
  {
    operation: "meeting.addAttendee",
    tool: "add_meeting_attendee",
    tier: "straight",
    not: "This tool does NOT add somebody to a calendar entry — that is add_people_to_entry. It also does not create a meeting.",
    does: "Add one person to an existing meeting. They are sent the join link automatically.",
    use: 'Use for "add Karthik to that meeting", "Meena should be in the review too".',
    args: z.object({
      meetingId: z.string().describe("From list_meetings."),
      attendee: z.string().describe("The employee id."),
    }),
    requires: { action: "view", nodeType: "meeting" },
  },
  {
    operation: "meeting.cancel",
    tool: "cancel_meeting",
    tier: "readBack",
    not: "This tool does NOT release a room while leaving the meeting standing — for that use cancel_room_booking. And it is not cancel_calendar_entry: THAT one removes an entry from the shared diary, THIS one calls off a meeting and tells everybody invited. \"Cancel Tuesday\" could mean either — find out which before calling.",
    does: "Call off a meeting. Everybody invited is told, the room is released and the join link is ended.",
    use: 'Use for "cancel the review", "call off Thursday\'s meeting".',
    args: z.object({
      meetingId: z.string().describe("From list_meetings."),
      ...CONFIRMATION_FIELD,
    }),
    target: (a) => String(a.meetingId),
    consequence:
      "Cancelling tells everybody invited, releases the room and ends the join link. It cannot be un-told.",
    requires: { action: "view", nodeType: "meeting" },
  },
  {
    operation: "meeting.recordDecisions",
    tool: "minute_meeting_decisions",
    tier: "straight",
    not: "This tool does NOT record an organisation-wide decision — that is log_decision, which is for durable policy anybody may later look up. THIS one minutes what was agreed inside one meeting.",
    does: "Record what a meeting decided, and the actions it produced.",
    use: 'Use for "minute that we agreed to ship v2", "note the actions from the review".',
    notes: ["An action needs an owner. A decision does not."],
    args: z.object({
      meetingId: z.string().describe("From list_meetings."),
      decisions: z
        .array(z.object({ text: z.string(), owner: z.string().optional() }))
        .optional(),
      actions: z
        .array(
          z.object({
            text: z.string(),
            owner: z.string().describe("Employee id. Required on an action."),
            due: z.string().optional().describe("YYYY-MM-DD."),
          }),
        )
        .optional(),
    }),
    requires: { action: "view", nodeType: "meeting" },
  },
  {
    operation: "meeting.completeAction",
    tool: "complete_meeting_action",
    tier: "straight",
    not: "This tool does NOT complete a TASK from the task board — that is complete_task. This is only for an action minuted inside a meeting.",
    does: "Mark an action from a meeting done.",
    use: 'Use for "I have written the migration notes" when that came out of a meeting.',
    args: z.object({
      meetingId: z.string().describe("From list_meetings."),
      actionId: z.string().describe("From get_meeting."),
    }),
    requires: { action: "view", nodeType: "meeting" },
  },

  // ── the shared calendar ──────────────────────────────────────────────────
  {
    operation: "calendar.create",
    tool: "create_calendar_entry",
    tier: "straight",
    not: "This tool does NOT arrange a meeting — it books no room, creates no join link and invites nobody. For people meeting each other use create_meeting. Use THIS for a deadline, a holiday, a visit or a note in the shared diary.",
    does: "Put an entry on the shared calendar.",
    use: 'Use for "put the audit on the calendar for the 14th", "mark Friday as a holiday".',
    args: z.object({
      title: z.string(),
      kind: z.enum(["meeting", "event"]).describe("How it is shown on the calendar."),
      date: z.string().describe("YYYY-MM-DD."),
      from: z.string().optional().describe("Start time, if it has one."),
      to: z.string().optional().describe("End time, if it has one."),
      detail: z.string().optional(),
      people: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .describe('Ids, or a description like "the course team".'),
    }),
  },
  {
    operation: "calendar.edit",
    tool: "edit_calendar_entry",
    tier: "straight",
    not: "This tool does NOT move a MEETING — that is update_meeting, and using this one on a meeting leaves the meeting itself where it was.",
    does: "Change a calendar entry's title, date, time or detail.",
    use: 'Use for "move the audit to the 20th", "rename that entry".',
    args: z.object({
      entryId: z.string().describe("From calendar_month."),
      title: z.string().optional(),
      date: z.string().optional().describe("YYYY-MM-DD."),
      from: z.string().optional(),
      to: z.string().optional(),
      detail: z.string().optional(),
    }),
  },
  {
    operation: "calendar.addPeople",
    tool: "add_people_to_entry",
    tier: "straight",
    not: "This tool does NOT add somebody to a MEETING — that is add_meeting_attendee, and only that one sends the join link.",
    does: "Add people to a calendar entry. They are told.",
    use: 'Use for "add the ops team to that entry".',
    args: z.object({
      entryId: z.string().describe("From calendar_month."),
      people: z
        .union([z.array(z.string()), z.string()])
        .describe('Ids, or a description like "everyone".'),
    }),
  },
  {
    operation: "calendar.removePeople",
    tool: "remove_people_from_entry",
    tier: "straight",
    not: "This tool does NOT cancel the entry for everybody — that is cancel_calendar_entry. It takes named people off it.",
    does: "Take people off a calendar entry. Each of them is told, and told who removed them.",
    use: 'Use for "take Ravi off that entry".',
    notes: ["Being dropped silently is the worst thing a shared calendar can do, so they are always told."],
    args: z.object({
      entryId: z.string().describe("From calendar_month."),
      people: z.array(z.string()).describe("Employee ids."),
    }),
  },
  {
    operation: "calendar.cancel",
    tool: "cancel_calendar_entry",
    tier: "readBack",
    not: "This tool does NOT call off a MEETING — that is cancel_meeting, which also releases the room and ends the join link. \"Cancel Tuesday\" could mean either; find out which. Using this on a meeting leaves the meeting running with nothing on the calendar.",
    does: "Cancel a calendar entry. Everybody on it is told.",
    use: 'Use for "cancel the audit", "take that off the calendar".',
    args: z.object({
      entryId: z.string().describe("From calendar_month."),
      ...CONFIRMATION_FIELD,
    }),
    target: (a) => String(a.entryId),
    consequence: "Cancelling takes it off the shared calendar and tells everybody on it.",
  },

  // ── rooms ────────────────────────────────────────────────────────────────
  {
    operation: "room.book",
    tool: "book_room",
    tier: "straight",
    not: "This tool does NOT arrange a meeting — nobody is invited and no join link is made. If people are meeting each other, use create_meeting, which books the room itself. Use THIS only for a room on its own.",
    does: "Book a room. If none is named, a suitable free one is chosen.",
    use: 'Use for "book Hall 2 for Tuesday at 3", "get me a room for six on Friday morning".',
    notes: [
      "If the room clashes it offers alternatives rather than refusing — read them back.",
      "Give capacity when you know how many people, or the room may be too small.",
    ],
    args: z.object({
      title: z.string().describe("What it is for."),
      from: z.string().describe("Start, ISO."),
      to: z.string().describe("End, ISO."),
      roomId: z.string().optional().describe("Only if they named one."),
      capacity: z.number().optional().describe("How many people will be in the room."),
      equipment: z.array(z.string()).optional().describe('e.g. ["projector"].'),
      displaceClash: z
        .boolean()
        .optional()
        .describe("Move a clashing booking to another room rather than refusing. Ask first."),
    }),
    requires: { action: "view", nodeType: "room" },
  },
  {
    operation: "room.cancel",
    tool: "cancel_room_booking",
    tier: "readBack",
    not: "This tool does NOT cancel the MEETING that the room was for — the meeting carries on with nowhere to happen. \"We don't need Hall 2\" usually means the room only; \"cancel the review\" means cancel_meeting. Getting this wrong leaves a meeting people still turn up to.",
    does: "Release a room booking.",
    use: 'Use for "we do not need Hall 2 after all", "release that booking".',
    args: z.object({
      bookingId: z.string().describe("From room_availability."),
      ...CONFIRMATION_FIELD,
    }),
    target: (a) => String(a.bookingId),
    consequence:
      "Releasing the room frees it for anybody else. If a meeting was relying on it, that meeting is left with nowhere to happen.",
    requires: { action: "view", nodeType: "room" },
  },

  // ── events ───────────────────────────────────────────────────────────────
  {
    operation: "event.create",
    tool: "create_event",
    tier: "straight",
    not: "This tool does NOT create a meeting or a calendar entry. An event is an organisation event with registrations, a capacity and a budget — use create_meeting for people meeting each other.",
    does: "Create an organisation event.",
    use: 'Use for "set up the open day on the 18th", "create the showcase event".',
    args: z.object({
      title: z.string(),
      date: z.string().describe("YYYY-MM-DD."),
      capacity: z.number().optional(),
      budgetLimit: z.number().optional(),
    }),
    requires: { action: "view", nodeType: "event" },
  },
  {
    operation: "event.addTask",
    tool: "add_event_task",
    tier: "straight",
    not: "This tool does NOT create a task on the task board — that is create_task. This one belongs to an event and only shows up there.",
    does: "Add a task to an event.",
    use: 'Use for "book the caterer for the open day".',
    args: z.object({
      eventId: z.string().describe("From list_events."),
      text: z.string().describe("What needs doing."),
      owner: z.string().optional().describe("Employee id, if somebody owns it."),
      due: z.string().optional().describe("YYYY-MM-DD."),
    }),
    requires: { action: "view", nodeType: "event" },
  },
  {
    operation: "event.register",
    tool: "register_for_event",
    tier: "straight",
    not: "This tool does NOT add somebody to a meeting or a calendar entry.",
    does: "Register somebody for an event.",
    use: 'Use for "put me down for the open day", "register Arun for the showcase".',
    args: z.object({
      eventId: z.string().describe("From list_events."),
      attendee: z.string().describe("The employee id."),
    }),
    requires: { action: "view", nodeType: "event" },
  },
  {
    operation: "event.close",
    tool: "close_event",
    tier: "readBack",
    not: "This tool does NOT cancel an event that has not happened — it closes one that has, with a report. There is no cancel for an event; if it is not happening, say so and ask.",
    does: "Close an event, with a report.",
    use: 'Use for "wrap up the open day", "close the showcase with the numbers".',
    args: z.object({
      eventId: z.string().describe("From list_events."),
      report: z.string().describe("How it went, in their words."),
      ...CONFIRMATION_FIELD,
    }),
    target: (a) => String(a.eventId),
    consequence: "Closing the event ends it and files the report. Registrations stop.",
    requires: { action: "view", nodeType: "event" },
  },

  // ── facilities ───────────────────────────────────────────────────────────
  {
    operation: "equipment.reportFault",
    tool: "report_fault",
    tier: "straight",
    not: "This tool does NOT book equipment or a room. It reports something broken.",
    does: "Report a fault on a piece of equipment. Facilities are told.",
    use: 'Use for "the projector in Hall 1 is broken", "log a fault on the printer".',
    args: z.object({
      equipmentId: z.string().describe("From list_equipment."),
      fault: z.string().describe("What is wrong, in their words."),
    }),
    requires: { action: "view", nodeType: "equipment" },
  },
  {
    operation: "utility.capture",
    tool: "capture_utility_reading",
    tier: "straight",
    not: "This tool does NOT report a fault — that is report_fault. It records a reading or a note in the utilities log.",
    does: "Record a utility reading or note.",
    use: 'Use for "the meter reads 4,210", "log the water reading".',
    args: z.object({
      subject: z.string().describe("Which utility."),
      detail: z.string().describe("The reading or note."),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  },

  // ── documents ────────────────────────────────────────────────────────────
  {
    operation: "document.store",
    tool: "store_document",
    tier: "straight",
    not: "This tool does NOT mark a document as REQUIRED of somebody — that is require_document. This one files a document that already exists.",
    does: "File a document against a record.",
    use: 'Use for "file Priya\'s contract", "store the signed policy".',
    args: z.object({
      name: z.string().describe("What the document is."),
      nodeType: z.string().describe('What it belongs to, e.g. "employee".'),
      nodeId: z
        .string()
        .describe(
          "The id of that record. Get it from whichever read tool covers that kind of record — find_people for an employee, get_course for a course. Never invent one.",
        ),
      contentType: z.string().optional(),
      blobRef: z.string().optional(),
      required: z.boolean().optional(),
      expiresOn: z.string().optional().describe("YYYY-MM-DD."),
      roleAccess: z.array(z.string()).optional().describe("Roles that may see it."),
    }),
    requires: { action: "view", nodeType: "document" },
  },
  {
    operation: "document.require",
    tool: "require_document",
    tier: "straight",
    not: "This tool does NOT file a document — it says one is expected and not yet supplied. To file one, use store_document.",
    does: "Mark a document as required against a record.",
    use: 'Use for "we need Meena\'s ID proof", "her contract is outstanding".',
    args: z.object({
      nodeType: z.string().describe('What it is required of, e.g. "employee".'),
      nodeId: z
        .string()
        .describe(
          "The id of that record. Get it from whichever read tool covers that kind of record — find_people for an employee, get_course for a course. Never invent one.",
        ),
      name: z.string().describe("Which document."),
      requiredBy: z.string().optional().describe("YYYY-MM-DD."),
    }),
    requires: { action: "view", nodeType: "document" },
  },

  // ── organisation memory ──────────────────────────────────────────────────
  {
    operation: "orgMemory.record",
    tool: "log_decision",
    tier: "straight",
    not: "This tool does NOT minute what one meeting agreed — that is minute_meeting_decisions. Use THIS for a durable organisational decision anybody may later look up, and the reason given at the time.",
    does: "Record an organisation decision, with the reason recorded at the time.",
    use: 'Use for "record that we decided to stop shadowing, because it was not helping".',
    notes: ["The reason matters as much as the decision — it is what people come back for."],
    args: z.object({
      title: z.string().describe("What it is about."),
      decision: z.string().describe("What was decided."),
      reason: z.string().describe("Why, as it was said at the time."),
      linkedRecords: z
        .array(z.object({ nodeType: z.string(), nodeId: z.string() }))
        .optional()
        .describe("Records this decision is about."),
    }),
    requires: { action: "view", nodeType: "org-memory" },
  },
  {
    operation: "notify.send",
    tool: "notify_people",
    // ⚠ READ-BACK, not straight through — and it was straight through until a
    // sweep over the whole catalogue caught it.
    //
    // `notify.send` has NO undo at all, and cannot have one: it puts a line in
    // somebody's notifications, and a notification that has been read cannot be
    // un-read. The rule is "no undo, no tool" unless the tool only PROPOSES,
    // and this is not a money or people decision, so proposing is too heavy.
    //
    // Reading it back is the proportionate answer: the person hears what is
    // about to be sent, and to whom, before it goes.
    tier: "readBack",
    not: "This tool does NOT send a chat message you can be replied to — that is send_message. It puts a one-way line in somebody's notifications, and it writes no record.",
    does: "Put a line in named people's notifications.",
    use: 'Use for "let the ops team know the hall is closed".',
    notes: ["It cannot be un-sent. There is no undo."],
    args: z.object({
      message: z.string().describe("What to tell them, in their words."),
      to: z.array(z.string()).describe("Employee ids."),
      ...CONFIRMATION_FIELD,
    }),
    target: (a) => `${(a.to as string[] | undefined)?.join(",") ?? ""}:${String(a.message ?? "")}`,
    consequence:
      "This goes straight into their notifications and CANNOT be un-sent. Read back who it is going to and exactly what it says.",
  },
];
