import { z } from "zod";
import { CONFIRMATION_FIELD, type WriteToolSpec } from "./build";

/**
 * Courses and tasks.
 *
 * ── Two confusions, and one of them destroys work ───────────────────────────
 *
 *   complete_task / delete_task     "get rid of that task"
 *   delete_course / update_course_stage   "drop that course"
 *
 * *"Get rid of that task"* is the sentence somebody says when they have
 * **finished** it. Reaching `delete_task` for that throws the work away and the
 * record of it having been done — which is why `delete_task` reads back, and
 * why `complete_task`'s description names it first.
 *
 * *"Drop that course"* almost always means moving it to a dropped **stage**,
 * not deleting the course and its versions.
 */

export const workWriteTools: WriteToolSpec[] = [
  // ── tasks ────────────────────────────────────────────────────────────────
  {
    operation: "task.create",
    tool: "create_task",
    tier: "straight",
    people: ["assignedTo"],
    not: "This tool does NOT add work to somebody's day plan for today — that is select_item, and only for yourself. It also does not create an event task; use add_event_task for that. THIS creates a task on the board, which somebody picks up on a day of their choosing.",
    does: "Create a task, optionally assigned to somebody.",
    use: 'Use for "create a task for Arun to review Module 4", "add a task to write the release notes".',
    notes: [
      "assignedTo takes a NAME or an employee id — pass what they said. You do not need to look the person up first.",
      "Leave it out only if they truly did not say who. Do not guess a person.",
    ],
    args: z.object({
      title: z.string().describe("What needs doing, in their words."),
      description: z.string().optional(),
      assignedTo: z
        .string()
        .optional()
        .describe(
          'Who it is for — a name ("Arun") or an employee id. Omit ONLY if they did not say who.',
        ),
      priority: z.string().optional().describe("high, medium, low."),
      dueDate: z.string().optional().describe("YYYY-MM-DD."),
      estimateMinutes: z.number().optional(),
      projectId: z.string().optional(),
      courseId: z.string().optional().describe("If the task belongs to a course."),
    }),
    requires: { action: "view", nodeType: "task" },
  },
  {
    operation: "task.assign",
    tool: "assign_task",
    tier: "straight",
    people: ["assignedTo"],
    not: "This tool does NOT create a task — use create_task, which can assign in the same step. This one moves an EXISTING task to somebody.",
    does: "Assign an existing task to somebody. They are told.",
    use: 'Use for "give that task to Karthik", "reassign the migration notes to Meena".',
    args: z.object({
      taskId: z.string().describe("From list_tasks."),
      assignedTo: z.string().describe("The employee id."),
    }),
    requires: { action: "view", nodeType: "task" },
  },
  {
    operation: "task.edit",
    tool: "edit_task",
    tier: "straight",
    not: "This tool does NOT change who a task belongs to — that is assign_task. It also does not mark it done; that is complete_task.",
    does: "Change a task's title, description, priority, due date or estimate.",
    use: 'Use for "make that task high priority", "push the due date to Friday".',
    args: z.object({
      taskId: z.string().describe("From list_tasks."),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.string().optional(),
      dueDate: z.string().optional().describe("YYYY-MM-DD."),
      estimateMinutes: z.number().optional(),
    }),
    requires: { action: "view", nodeType: "task" },
  },
  {
    operation: "task.start",
    tool: "start_task",
    tier: "straight",
    not: "This tool does NOT put the task on today's plan — that is select_item. It moves the card to in progress on the board.",
    does: "Move a task to in progress.",
    use: 'Use for "I have started the migration notes".',
    args: z.object({
      taskId: z.string().describe("From list_tasks."),
    }),
    requires: { action: "view", nodeType: "task" },
  },
  {
    operation: "task.complete",
    tool: "complete_task",
    tier: "straight",
    not: "This tool is NOT delete_task. \"Get rid of that task\" is what somebody says when they have FINISHED it — that is THIS tool. delete_task throws the task away along with any record of it having been done, and is almost never what they mean. It is also not mark_done, which is for an item on today's plan.",
    does: "Mark a task done.",
    use: 'Use for "I have finished the review", "that task is done", "tick off the migration notes".',
    args: z.object({
      taskId: z.string().describe("From list_tasks."),
    }),
    requires: { action: "view", nodeType: "task" },
  },
  {
    operation: "task.delete",
    tool: "delete_task",
    tier: "readBack",
    not: "This tool is NOT complete_task, and it is NOT drop_item. It DESTROYS the task and the record of it. If they have finished the work, use complete_task. If they mean it is off today's plan but still owed, use carry_over or drop_item. Only use this when the task should never have existed.",
    does: "Delete a task permanently.",
    use: 'Use only for "delete that task", "that task was created by mistake".',
    args: z.object({
      taskId: z.string().describe("From list_tasks."),
      ...CONFIRMATION_FIELD,
    }),
    target: (a) => String(a.taskId),
    consequence:
      "Deleting removes the task and any record of the work. If it was finished, completing it instead keeps that record.",
    requires: { action: "view", nodeType: "task" },
  },

  // ── courses ──────────────────────────────────────────────────────────────
  {
    operation: "course.create",
    tool: "create_course",
    tier: "straight",
    people: ["owner"],
    not: "This tool does NOT assign a course to anybody — that is assign_course, and it is a separate step.",
    does: "Create a course, optionally with its modules.",
    use: 'Use for "create a course on spreadsheet automation".',
    args: z.object({
      title: z.string(),
      modules: z.array(z.string()).optional().describe("Module titles, in order."),
      owner: z.string().optional().describe("Employee id of the owner."),
    }),
    requires: { action: "view", nodeType: "course" },
  },
  {
    operation: "course.assign",
    tool: "assign_course",
    tier: "propose",
    not: "This tool does NOT create a task on the board — though it writes one per person as a side effect. It also does not create the course; use create_course.",
    does: "Assign a course to people. Each gets a task and is told.",
    use: 'Use for "put Priya and Arun on the AI basics course".',
    args: z.object({
      courseId: z.string().describe("From get_course or course_progress."),
      assignees: z.array(z.string()).describe("Employee ids."),
    }),
    summary: (a) =>
      `assign course ${a.courseId} to ${(a.assignees as string[] | undefined)?.join(", ") ?? "nobody"}`,
    requires: { action: "view", nodeType: "course" },
  },
  {
    operation: "course.updateStage",
    tool: "update_course_stage",
    tier: "straight",
    not: "This tool is NOT delete_course. \"Drop that course\" almost always means moving it to a dropped STAGE — which is this tool — and not destroying it and its versions.",
    does: "Move a course to another stage in the pipeline.",
    use: 'Use for "move that course to review", "the AI course is live now", "drop that course".',
    args: z.object({
      courseId: z.string().describe("From get_course."),
      stage: z.string().describe("The stage name, in their words."),
    }),
    requires: { action: "view", nodeType: "course" },
  },
  {
    operation: "course.assignStageOwner",
    tool: "assign_stage_owner",
    tier: "straight",
    people: ["owner"],
    not: "This tool does NOT assign the COURSE to somebody to study — that is assign_course. This names who owns one stage of it, usually a reviewer.",
    does: "Name who owns a stage of a course.",
    use: 'Use for "Karthik reviews that course", "put Meena on the review stage".',
    args: z.object({
      courseId: z.string().describe("From get_course."),
      stage: z.string().describe("Which stage."),
      owner: z.string().describe("The employee id."),
    }),
    requires: { action: "view", nodeType: "course" },
  },
  {
    operation: "course.setModuleState",
    tool: "set_module_state",
    tier: "straight",
    not: "This tool does NOT move the whole course along — that is update_course_stage. It changes ONE module.",
    does: "Set the state of one module in a course.",
    use: 'Use for "module 4 is written", "mark module 2 as in review".',
    args: z.object({
      courseId: z.string().describe("From get_course."),
      moduleIndex: z.number().describe("Which module, counting from 0."),
      state: z.string().describe("The state, in their words."),
    }),
    requires: { action: "view", nodeType: "course" },
  },
  {
    operation: "course.setProgressNote",
    tool: "set_progress_note",
    tier: "straight",
    not: "This tool does NOT change a stage or a module state. It leaves a note against the course's progress.",
    does: "Leave a progress note on a course.",
    use: 'Use for "note that the course is waiting on the designer".',
    args: z.object({
      courseId: z.string().describe("From get_course."),
      note: z.string().describe("The note, in their words."),
    }),
    requires: { action: "view", nodeType: "course" },
  },
  {
    operation: "course.restoreVersion",
    tool: "restore_course_version",
    tier: "straight",
    not: "This tool does NOT undo the last change generally — that is undo_last. It puts a specific earlier VERSION of a course back.",
    does: "Restore a course to an earlier version.",
    use: 'Use for "put the course back to version 3".',
    notes: ["course_versions lists what there is to go back to."],
    args: z.object({
      courseId: z.string().describe("From get_course."),
      version: z.number().describe("From course_versions."),
    }),
    requires: { action: "view", nodeType: "course" },
  },
  {
    operation: "course.delete",
    tool: "delete_course",
    tier: "readBack",
    not: "This tool is NOT update_course_stage. \"Drop that course\" nearly always means moving it to a dropped stage, which keeps it and its versions. THIS destroys the course. Only use it when the course should never have existed.",
    does: "Delete a course.",
    use: 'Use only for "delete that course", "that course was created by mistake".',
    args: z.object({
      courseId: z.string().describe("From get_course."),
      ...CONFIRMATION_FIELD,
    }),
    target: (a) => String(a.courseId),
    consequence:
      "Deleting removes the course and its versions. Moving it to a dropped stage keeps both.",
    requires: { action: "view", nodeType: "course" },
  },
];
