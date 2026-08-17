/**
 * Person-scoping classes for the N1 DocTypes that are NOT already
 * `sensitive` (sensitive types are HR/admin-gated by their own rules).
 *
 * Three classes:
 *  - PERSON-SCOPED: the record belongs to one named employee. Everyone keeps
 *    their own; a manager sees their team; HR and admins see the organisation.
 *  - CONFIDENTIAL:  recruitment records and bulk admin tools. Candidate
 *    details, interview feedback and job offers are about people who never
 *    consented to colleagues reading them; HR and admins only.
 *  - everything else is REFERENCE data (leave types, holiday lists, shift
 *    types…) and stays readable by every role, exactly as before.
 *
 * Before this split, every non-sensitive DocType was `view` for all six roles
 * with `all` scope — an intern could read the whole organisation's attendance,
 * leave (including reasons people gave) and recruitment pipeline.
 */

/** Fields that may carry the owning employee's id, in lookup order. */
export const PERSON_OWNER_FIELDS = ["employee", "employeeId"] as const;

/** Non-sensitive N1 node types that belong to one named employee. */
export const PERSON_SCOPED_NODE_TYPES: ReadonlySet<string> = new Set([
  // attendance
  "attendance",
  "employee-checkin",
  "shift-assignment",
  "shift-schedule-assignment",
  "shift-request",
  "attendance-request",
  "holiday-list-assignment",
  // leave
  "leave",
  "leave-allocation",
  "leave-ledger-entry",
  "leave-encashment",
  "compensatory-leave-request",
  "leave-adjustment",
  "leave-policy-assignment",
  "earned-leave-schedule",
  // lifecycle (non-sensitive)
  "employee-onboarding",
  "employee-boarding-activity",
  // performance (non-sensitive)
  "employee-skill",
  "appraisee",
  // training (non-sensitive)
  "training-event-employee",
]);

/** Non-sensitive N1 node types visible to HR and admins only. */
export const CONFIDENTIAL_NODE_TYPES: ReadonlySet<string> = new Set([
  // recruitment — the whole pipeline
  "job-opening",
  "job-opening-template",
  "job-requisition",
  "staffing-plan",
  "staffing-plan-detail",
  "job-applicant",
  "job-applicant-source",
  "interview",
  "interview-detail",
  "interview-type",
  "interviewer",
  "interview-feedback",
  "skill-assessment",
  "job-offer",
  "job-offer-term",
  "job-offer-term-template",
  "offer-term",
  "appointment-letter",
  "appointment-letter-content",
  "appointment-letter-template",
  "employee-referral",
  // bulk admin tools — not records anyone browses
  "employee-attendance-tool",
  "upload-attendance",
  "shift-assignment-tool",
  "leave-control-panel",
]);

/** The employee a person-scoped record belongs to, from its own fields. */
export function ownerOfRecordData(data: Record<string, unknown>): string | undefined {
  for (const field of PERSON_OWNER_FIELDS) {
    const v = data[field];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}
