import { z } from "zod";
import type { WriteToolSpec } from "./build";

/**
 * HR, leave, expenses and attendance — **every one of them proposes**.
 *
 * Twenty of the fifty-six operations would stop and ask if a standing rule had
 * submitted them, and the agent is held to the same line: it prepares, and a
 * person approves. Nothing in this file can act on its own.
 *
 * The tier is declared here for the model's benefit — the description has to
 * say "this does not do it" — but it is **not** what enforces the gate.
 * `build.ts` asks the handler itself, so a tier written down wrongly can only
 * ever make a tool stricter, never looser.
 */

const employeeId = z.string().describe("The employee id, from find_people or get_person.");

export const peopleWriteTools: WriteToolSpec[] = [
  // ── leave ────────────────────────────────────────────────────────────────
  {
    operation: "leave.approve",
    tool: "approve_leave",
    tier: "propose",
    not: "This tool does NOT approve an expense claim — for that use approve_expense. It also does not create leave; use request_leave. And it is not how leave is refused: that is decline_leave.",
    does: "Approve somebody's leave request.",
    use: 'Use for "approve Priya\'s leave", "yes to that leave request", "sign off her time off".',
    notes: [
      "You need the LEAVE id, not the person id — list_leave returns it.",
    ],
    args: z.object({
      leaveId: z.string().describe("The leave request id, from list_leave."),
    }),
    summary: (a) => `approve leave request ${a.leaveId}`,
    requires: { action: "view", nodeType: "leave" },
  },
  {
    operation: "leave.decline",
    tool: "decline_leave",
    tier: "propose",
    not: "This tool does NOT decline an EXPENSE claim — that is decline_expense, and the two sound identical when somebody says \"reject that request\". Check which kind of request they mean before choosing. It also does not delete the request; a declined request stays on the record with its reason.",
    does: "Decline somebody's leave request, with a reason.",
    use: 'Use for "decline that leave", "no to Priya\'s time off", "reject the leave request".',
    notes: ["A reason is required — it is what the person is told."],
    args: z.object({
      leaveId: z.string().describe("The leave request id, from list_leave."),
      reason: z.string().describe("Why, in their words. The person sees this."),
    }),
    summary: (a) => `decline leave request ${a.leaveId} — "${a.reason}"`,
    requires: { action: "view", nodeType: "leave" },
  },
  {
    operation: "leave.request",
    tool: "request_leave",
    tier: "propose",
    not: "This tool does NOT approve leave and does not check whether it will be granted — it files the request. To approve one, use approve_leave.",
    does: "File a leave request for somebody.",
    use: 'Use for "book me off next Friday", "request leave for the 3rd to the 5th".',
    args: z.object({
      employeeId,
      fromDate: z.string().describe("First day off, YYYY-MM-DD."),
      toDate: z.string().describe("Last day off, YYYY-MM-DD. Same as fromDate for one day."),
      type: z.string().optional().describe("Casual, sick, earned — if they said."),
      reason: z.string().optional().describe("If they gave one. Never press."),
    }),
    summary: (a) => `request leave for ${a.employeeId} from ${a.fromDate} to ${a.toDate}`,
    requires: { action: "view", nodeType: "leave" },
  },

  // ── expenses ─────────────────────────────────────────────────────────────
  {
    operation: "expense.approve",
    tool: "approve_expense",
    tier: "propose",
    not: "This tool does NOT approve LEAVE — that is approve_leave. \"Approve that request\" is ambiguous between the two; find out which before calling either.",
    does: "Approve an expense claim.",
    use: 'Use for "approve that claim", "yes to Arun\'s expenses", "sign off the travel claim".',
    args: z.object({
      claimId: z.string().describe("The claim id."),
    }),
    summary: (a) => `approve expense claim ${a.claimId}`,
    requires: { action: "view", nodeType: "expense" },
  },
  {
    operation: "expense.decline",
    tool: "decline_expense",
    tier: "propose",
    not: "This tool does NOT decline LEAVE — that is decline_leave. Both answer \"reject that request\", and picking the wrong one refuses something nobody asked you to refuse.",
    does: "Decline an expense claim, with a reason.",
    use: 'Use for "decline that claim", "reject the travel expenses".',
    args: z.object({
      claimId: z.string().describe("The claim id."),
      reason: z.string().describe("Why. The claimant sees this."),
    }),
    summary: (a) => `decline expense claim ${a.claimId} — "${a.reason}"`,
    requires: { action: "view", nodeType: "expense" },
  },
  {
    operation: "expense.claim",
    tool: "claim_expense",
    tier: "propose",
    not: "This tool does NOT approve or pay anything — it files a claim. To approve one, use approve_expense.",
    does: "File an expense claim.",
    use: 'Use for "claim the taxi fare", "put in 1,200 for the client lunch".',
    args: z.object({
      employeeId,
      amount: z.number().describe("The amount, as a number."),
      category: z.string().describe("Travel, meals, equipment — in their words."),
      description: z.string().describe("What it was for."),
      date: z.string().describe("When it was spent, YYYY-MM-DD."),
    }),
    summary: (a) => `claim ${a.amount} for ${a.category} on behalf of ${a.employeeId}`,
    requires: { action: "view", nodeType: "expense" },
  },

  // ── the employee record ──────────────────────────────────────────────────
  {
    operation: "employee.create",
    tool: "create_employee",
    tier: "propose",
    not: "This tool does NOT start the joining checklist — that is start_joining, and it is a separate step after the record exists. It also does not set pay; use set_pay.",
    does: "Create an employee record and their login.",
    use: 'Use for "add Meena as an employee", "set up a record for the new designer".',
    notes: ["A temporary password is required; they must change it at first sign-in."],
    args: z.object({
      employeeId: z.string().describe("The id to give them, e.g. their first name in lower case."),
      name: z.string().describe("Their full name, as it should appear."),
      role: z.string().describe("employee, manager, hr, intern, admin."),
      username: z.string().describe("What they sign in with."),
      temporaryPassword: z.string().describe("A first-sign-in password. They must replace it."),
      contact: z.string().optional(),
      team: z.string().optional(),
      joiningDate: z.string().optional().describe("YYYY-MM-DD."),
      managerId: z.string().optional(),
      departmentId: z.string().optional(),
      designationId: z.string().optional(),
    }),
    summary: (a) => `create an employee record for ${a.name} (${a.employeeId})`,
    requires: { action: "view", nodeType: "employee" },
  },
  {
    operation: "employee.deactivate",
    tool: "deactivate_employee",
    tier: "propose",
    not: "This tool does NOT run somebody's leaving process — that is start_leaving, which does the handover and the checklist. \"Priya is leaving\" almost always means start_leaving, NOT this. Use this only when the record itself is to be stood down.",
    does: "Stand an employee record down.",
    use: 'Use only for "deactivate that record", "close the account".',
    args: z.object({
      employeeId,
      lastWorkingDay: z.string().describe("YYYY-MM-DD."),
      reason: z.string().describe("Why."),
    }),
    summary: (a) => `deactivate ${a.employeeId} from ${a.lastWorkingDay}`,
    requires: { action: "view", nodeType: "employee" },
  },
  {
    operation: "employee.reactivate",
    tool: "reactivate_employee",
    tier: "propose",
    not: "This tool does NOT create a new record — use create_employee for somebody who never had one.",
    does: "Bring a stood-down employee record back, with a new temporary password.",
    use: 'Use for "bring Ravi back", "reactivate that account".',
    args: z.object({
      employeeId,
      temporaryPassword: z.string().describe("A fresh first-sign-in password."),
    }),
    summary: (a) => `reactivate ${a.employeeId}`,
    requires: { action: "view", nodeType: "employee" },
  },
  {
    operation: "employee.setPay",
    tool: "set_pay",
    tier: "propose",
    not: "This tool does NOT approve an expense or file a claim. It sets somebody's pay.",
    does: "Set an employee's pay, from a date.",
    use: 'Use for "put Arun on 60,000 from April".',
    args: z.object({
      employeeId,
      pay: z.number().describe("The amount, as a number."),
      effectiveFrom: z.string().describe("YYYY-MM-DD."),
    }),
    summary: (a) => `set ${a.employeeId} pay to ${a.pay} from ${a.effectiveFrom}`,
    requires: { action: "view", nodeType: "employee" },
  },
  {
    operation: "employee.update",
    tool: "update_employee",
    tier: "propose",
    not: "This tool does NOT change only a contact detail — update_contact is narrower and is the right one for a phone number or an email. It also does not set pay; use set_pay.",
    does: "Change an employee's name, team, manager, department or designation.",
    use: 'Use for "move Karthik to the ops team", "Priya reports to James now".',
    args: z.object({
      employeeId,
      patch: z
        .object({
          name: z.string().optional(),
          contact: z.string().optional(),
          team: z.string().optional(),
          managerId: z.string().optional(),
          departmentId: z.string().optional(),
          designationId: z.string().optional(),
        })
        .describe("Only the fields that change."),
    }),
    summary: (a) => `update ${a.employeeId}: ${Object.keys((a.patch ?? {}) as object).join(", ")}`,
    requires: { action: "view", nodeType: "employee" },
  },
  {
    operation: "employee.updateContact",
    tool: "update_contact",
    tier: "propose",
    not: "This tool does NOT change a team, a manager or a designation — that is update_employee. It changes ONLY a contact detail: a phone number or an email.",
    does: "Change an employee's contact detail.",
    use: 'Use for "Priya\'s new number is...", "update Arun\'s email".',
    args: z.object({
      employeeId,
      contact: z.string().describe("The new phone number or email."),
    }),
    summary: (a) => `change ${a.employeeId} contact to ${a.contact}`,
    requires: { action: "view", nodeType: "employee" },
  },

  // ── joining and leaving ──────────────────────────────────────────────────
  {
    operation: "joining.start",
    tool: "start_joining",
    tier: "propose",
    not: "This tool does NOT create the employee record — create_employee does that first. It is also not the leaving process; that is start_leaving.",
    does: "Begin somebody's joining checklist.",
    use: 'Use for "start Meena\'s onboarding", "kick off the joining steps".',
    args: z.object({
      employeeId,
      steps: z
        .array(
          z.object({
            title: z.string(),
            owner: z.string().describe("Who does this step."),
            dueAt: z.string().describe("YYYY-MM-DD."),
          }),
        )
        .optional()
        .describe("Leave out to use the standard checklist."),
    }),
    summary: (a) => `start the joining checklist for ${a.employeeId}`,
    requires: { action: "view", nodeType: "onboarding" },
  },
  {
    operation: "joining.completeStep",
    tool: "complete_joining_step",
    tier: "propose",
    not: "This tool does NOT complete a leaving handover — that is complete_handover. It also does not complete a task; use complete_task.",
    does: "Mark one step of a joining checklist done.",
    use: 'Use for "the laptop is issued", "Meena has her ID card".',
    args: z.object({
      employeeId,
      stepId: z.string().describe("The step id, from joining_status."),
    }),
    summary: (a) => `mark joining step ${a.stepId} done for ${a.employeeId}`,
    requires: { action: "view", nodeType: "onboarding" },
  },
  {
    operation: "leaving.start",
    tool: "start_leaving",
    tier: "propose",
    not: "This tool is NOT deactivate_employee. \"Priya is leaving\" means THIS — the handover and the checklist — not standing the record down. Deactivating without a handover loses everything she owns.",
    does: "Begin somebody's leaving process, from a separation date.",
    use: 'Use for "Priya is leaving on the 30th", "start Arun\'s offboarding".',
    args: z.object({
      employeeId,
      separationDate: z.string().describe("Last working day, YYYY-MM-DD."),
    }),
    summary: (a) => `start leaving for ${a.employeeId}, separating ${a.separationDate}`,
    requires: { action: "view", nodeType: "offboarding" },
  },
  {
    operation: "leaving.completeHandover",
    tool: "complete_handover",
    tier: "propose",
    not: "This tool does NOT complete a JOINING step — that is complete_joining_step.",
    does: "Mark one handover item done in somebody's leaving process.",
    use: 'Use for "the course has been handed to Karthik".',
    args: z.object({
      employeeId,
      handoverId: z.string().describe("The handover item id, from handover_status."),
    }),
    summary: (a) => `complete handover ${a.handoverId} for ${a.employeeId}`,
    requires: { action: "view", nodeType: "offboarding" },
  },
  {
    operation: "leaving.applySeparation",
    tool: "apply_separation",
    tier: "propose",
    not: "This tool does NOT begin the leaving process — start_leaving does, and this is the LAST step, after the handover is done. Running it early strands whatever has not been handed over.",
    does: "Apply the separation once the leaving process is finished.",
    use: 'Use for "close out Priya\'s leaving", "apply the separation".',
    args: z.object({ employeeId }),
    summary: (a) => `apply separation for ${a.employeeId}`,
    requires: { action: "view", nodeType: "offboarding" },
  },

  // ── attendance ───────────────────────────────────────────────────────────
  // Self-only: `execute` throws unless employeeId === the actor. They still
  // propose rather than act, because they would park for a standing rule and
  // "would park" is the whole rule. One consistent line beats an exemption
  // that has to be argued for every time somebody reads it.
  {
    operation: "attendance.checkIn",
    tool: "clock_in",
    tier: "propose",
    not: "This tool does NOT start somebody's day plan — that is a different thing entirely. It also cannot clock anybody else in: the operation refuses outright unless it is you.",
    does: "Clock in for today.",
    use: 'Use for "clock me in", "I am in".',
    args: z.object({
      employeeId: z.string().describe("Must be the person asking. It cannot be anybody else."),
      date: z.string().describe("YYYY-MM-DD."),
      at: z.string().optional().describe("An ISO time, if not now."),
    }),
    summary: (a) => `clock in for ${a.date}`,
    requires: { action: "view", nodeType: "attendance" },
  },
  {
    operation: "attendance.checkOut",
    tool: "clock_out",
    tier: "propose",
    not: "This tool does NOT close the day plan or fold it into the streak — that is close_out. It records the time you left; it cannot clock anybody else out.",
    does: "Clock out for today.",
    use: 'Use for "clock me out", "I am off".',
    args: z.object({
      employeeId: z.string().describe("Must be the person asking. It cannot be anybody else."),
      date: z.string().describe("YYYY-MM-DD."),
      at: z.string().optional().describe("An ISO time, if not now."),
    }),
    summary: (a) => `clock out for ${a.date}`,
    requires: { action: "view", nodeType: "attendance" },
  },
];
