import type { N1Record } from "@/config/providers";
import type { NodeId } from "@/spine/operation/types";
import type { RecordData } from "@/spine/record/types";

/**
 * N1 DocType registry.
 *
 * Every N1 DocType we surface is declared here with:
 *  - nodeType:  our internal node type (slug)
 *  - category:  grouping used by the /records browser + permission rules
 *  - idField:   N1 field whose value becomes our nodeId (default: record.name)
 *  - sensitive: true → pay/HR-gated (payroll, payslips, appraisals, tax…)
 *
 * Field normalization is generic: every N1 snake_case field is camelCased, then
 * `fields` renames are applied on top. Specific mappers (Employee, Leave Application,
 * Attendance, Salary Slip) keep their richer shape in n1-mapping.ts; everything else
 * flows through applyFieldMap.
 */

export type N1Category =
  | "payroll"
  | "recruitment"
  | "leave"
  | "expense"
  | "attendance"
  | "performance"
  | "training"
  | "lifecycle";

export interface DoctypeMapping {
  doctype: string;
  nodeType: string;
  category: N1Category;
  idField?: string;
  sensitive?: boolean;
  /** explicit field renames (n1 snake_case → our camelCase). Defaults: snake→camel. */
  fields?: Record<string, string>;
}

const PAYROLL: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Salary Slip", nodeType: "payslip", sensitive: true },
  { doctype: "Salary Structure", nodeType: "salary-structure", sensitive: true },
  { doctype: "Salary Component", nodeType: "salary-component", sensitive: true },
  { doctype: "Salary Detail", nodeType: "salary-detail", sensitive: true },
  { doctype: "Salary Structure Assignment", nodeType: "salary-structure-assignment", sensitive: true },
  { doctype: "Bulk Salary Structure Assignment", nodeType: "bulk-salary-structure-assignment", sensitive: true },
  { doctype: "Payroll Entry", nodeType: "payroll-entry", sensitive: true },
  { doctype: "Payroll Period", nodeType: "payroll-period" },
  { doctype: "Payroll Period Date", nodeType: "payroll-period-date" },
  { doctype: "Payroll Settings", nodeType: "payroll-settings", sensitive: true },
  { doctype: "Income Tax Slab", nodeType: "income-tax-slab", sensitive: true },
  { doctype: "Income Tax Slab Other Charges", nodeType: "income-tax-slab-other-charges", sensitive: true },
  { doctype: "Taxable Salary Slab", nodeType: "taxable-salary-slab", sensitive: true },
  { doctype: "Employee Tax Exemption Declaration", nodeType: "tax-exemption-declaration", sensitive: true },
  { doctype: "Employee Tax Exemption Declaration Category", nodeType: "tax-exemption-declaration-category", sensitive: true },
  { doctype: "Employee Tax Exemption Category", nodeType: "tax-exemption-category", sensitive: true },
  { doctype: "Employee Tax Exemption Sub Category", nodeType: "tax-exemption-sub-category", sensitive: true },
  { doctype: "Employee Tax Exemption Proof Submission", nodeType: "tax-exemption-proof", sensitive: true },
  { doctype: "Employee Tax Exemption Proof Submission Detail", nodeType: "tax-exemption-proof-detail", sensitive: true },
  { doctype: "Gratuity", nodeType: "gratuity", sensitive: true },
  { doctype: "Gratuity Rule", nodeType: "gratuity-rule", sensitive: true },
  { doctype: "Gratuity Rule Slab", nodeType: "gratuity-rule-slab", sensitive: true },
  { doctype: "Gratuity Applicable Component", nodeType: "gratuity-applicable-component", sensitive: true },
  { doctype: "Employee Benefit Application", nodeType: "benefit-application", sensitive: true },
  { doctype: "Employee Benefit Application Detail", nodeType: "benefit-application-detail", sensitive: true },
  { doctype: "Employee Benefit Claim", nodeType: "benefit-claim", sensitive: true },
  { doctype: "Employee Benefit Detail", nodeType: "benefit-detail", sensitive: true },
  { doctype: "Employee Benefit Ledger", nodeType: "benefit-ledger", sensitive: true },
  { doctype: "Additional Salary", nodeType: "additional-salary", sensitive: true },
  { doctype: "Arrear", nodeType: "arrear", sensitive: true },
  { doctype: "Retention Bonus", nodeType: "retention-bonus", sensitive: true },
  { doctype: "Employee Incentive", nodeType: "employee-incentive", sensitive: true },
  { doctype: "Overtime Slip", nodeType: "overtime-slip", sensitive: true },
  { doctype: "Overtime Type", nodeType: "overtime-type", sensitive: true },
  { doctype: "Overtime Details", nodeType: "overtime-details", sensitive: true },
  { doctype: "Overtime Salary Component", nodeType: "overtime-salary-component", sensitive: true },
  { doctype: "Salary Withholding", nodeType: "salary-withholding", sensitive: true },
  { doctype: "Salary Withholding Cycle", nodeType: "salary-withholding-cycle", sensitive: true },
  { doctype: "Payroll Correction", nodeType: "payroll-correction", sensitive: true },
  { doctype: "Payroll Correction Child", nodeType: "payroll-correction-child", sensitive: true },
  { doctype: "Payroll Employee Detail", nodeType: "payroll-employee-detail", sensitive: true },
];

const RECRUITMENT: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Job Opening", nodeType: "job-opening" },
  { doctype: "Job Opening Template", nodeType: "job-opening-template" },
  { doctype: "Job Requisition", nodeType: "job-requisition" },
  { doctype: "Staffing Plan", nodeType: "staffing-plan" },
  { doctype: "Staffing Plan Detail", nodeType: "staffing-plan-detail" },
  { doctype: "Job Applicant", nodeType: "job-applicant" },
  { doctype: "Job Applicant Source", nodeType: "job-applicant-source" },
  { doctype: "Interview", nodeType: "interview" },
  { doctype: "Interview Detail", nodeType: "interview-detail" },
  { doctype: "Interview Type", nodeType: "interview-type" },
  { doctype: "Interviewer", nodeType: "interviewer" },
  { doctype: "Interview Feedback", nodeType: "interview-feedback" },
  { doctype: "Skill Assessment", nodeType: "skill-assessment" },
  { doctype: "Job Offer", nodeType: "job-offer" },
  { doctype: "Job Offer Term", nodeType: "job-offer-term" },
  { doctype: "Job Offer Term Template", nodeType: "job-offer-term-template" },
  { doctype: "Offer Term", nodeType: "offer-term" },
  { doctype: "Appointment Letter", nodeType: "appointment-letter" },
  { doctype: "Appointment Letter Content", nodeType: "appointment-letter-content" },
  { doctype: "Appointment Letter Template", nodeType: "appointment-letter-template" },
  { doctype: "Employee Referral", nodeType: "employee-referral" },
  { doctype: "Employee Onboarding", nodeType: "employee-onboarding", category: "lifecycle" },
  { doctype: "Employee Onboarding Template", nodeType: "employee-onboarding-template", category: "lifecycle" },
  { doctype: "Employee Boarding Activity", nodeType: "employee-boarding-activity", category: "lifecycle" },
];

const LEAVE: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Leave Type", nodeType: "leave-type" },
  { doctype: "Leave Policy", nodeType: "leave-policy" },
  { doctype: "Leave Policy Assignment", nodeType: "leave-policy-assignment" },
  { doctype: "Leave Policy Detail", nodeType: "leave-policy-detail" },
  { doctype: "Leave Allocation", nodeType: "leave-allocation" },
  { doctype: "Leave Period", nodeType: "leave-period" },
  { doctype: "Leave Ledger Entry", nodeType: "leave-ledger-entry" },
  { doctype: "Leave Block List", nodeType: "leave-block-list" },
  { doctype: "Leave Block List Date", nodeType: "leave-block-list-date" },
  { doctype: "Leave Block List Allow", nodeType: "leave-block-list-allow" },
  { doctype: "Leave Encashment", nodeType: "leave-encashment" },
  { doctype: "Compensatory Leave Request", nodeType: "compensatory-leave-request" },
  { doctype: "Earned Leave Schedule", nodeType: "earned-leave-schedule" },
  { doctype: "Leave Adjustment", nodeType: "leave-adjustment" },
  { doctype: "Leave Control Panel", nodeType: "leave-control-panel" },
  { doctype: "Leave Application", nodeType: "leave" },
  { doctype: "Holiday List", nodeType: "holiday-list", category: "attendance" },
];

const EXPENSE: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Expense Claim", nodeType: "expense-claim", sensitive: true },
  { doctype: "Expense Claim Type", nodeType: "expense-claim-type" },
  { doctype: "Expense Claim Detail", nodeType: "expense-claim-detail", sensitive: true },
  { doctype: "Expense Claim Account", nodeType: "expense-claim-account", sensitive: true },
  { doctype: "Expense Claim Advance", nodeType: "expense-claim-advance", sensitive: true },
  { doctype: "Expense Taxes and Charges", nodeType: "expense-taxes-charges", sensitive: true },
  { doctype: "Travel Request", nodeType: "travel-request", sensitive: true },
  { doctype: "Travel Itinerary", nodeType: "travel-itinerary", sensitive: true },
  { doctype: "Travel Request Costing", nodeType: "travel-request-costing", sensitive: true },
  { doctype: "Purpose of Travel", nodeType: "purpose-of-travel" },
  { doctype: "Employee Advance", nodeType: "employee-advance", sensitive: true },
  { doctype: "Vehicle Log", nodeType: "vehicle-log" },
  { doctype: "Vehicle Service", nodeType: "vehicle-service" },
  { doctype: "Vehicle Service Item", nodeType: "vehicle-service-item" },
];

const ATTENDANCE: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Attendance", nodeType: "attendance" },
  { doctype: "Employee Checkin", nodeType: "employee-checkin" },
  { doctype: "Employee Attendance Tool", nodeType: "employee-attendance-tool" },
  { doctype: "Upload Attendance", nodeType: "upload-attendance" },
  { doctype: "Shift Type", nodeType: "shift-type" },
  { doctype: "Shift Assignment", nodeType: "shift-assignment" },
  { doctype: "Shift Assignment Tool", nodeType: "shift-assignment-tool" },
  { doctype: "Shift Request", nodeType: "shift-request" },
  { doctype: "Shift Location", nodeType: "shift-location" },
  { doctype: "Shift Schedule", nodeType: "shift-schedule" },
  { doctype: "Shift Schedule Assignment", nodeType: "shift-schedule-assignment" },
  { doctype: "Attendance Request", nodeType: "attendance-request" },
  { doctype: "Holiday List Assignment", nodeType: "holiday-list-assignment" },
];

const PERFORMANCE: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Appraisal", nodeType: "appraisal", sensitive: true },
  { doctype: "Appraisal Cycle", nodeType: "appraisal-cycle" },
  { doctype: "Appraisal Template", nodeType: "appraisal-template" },
  { doctype: "Appraisal Goal", nodeType: "appraisal-goal", sensitive: true },
  { doctype: "Appraisal KRA", nodeType: "appraisal-kra", sensitive: true },
  { doctype: "Appraisal Template Goal", nodeType: "appraisal-template-goal" },
  { doctype: "Appraisee", nodeType: "appraisee" },
  { doctype: "Employee Performance Feedback", nodeType: "performance-feedback", sensitive: true },
  { doctype: "Employee Feedback Criteria", nodeType: "feedback-criteria" },
  { doctype: "Employee Feedback Rating", nodeType: "feedback-rating", sensitive: true },
  { doctype: "Goal", nodeType: "goal", sensitive: true },
  { doctype: "KRA", nodeType: "kra" },
  { doctype: "Skill", nodeType: "skill" },
  { doctype: "Employee Skill", nodeType: "employee-skill" },
  { doctype: "Employee Skill Map", nodeType: "employee-skill-map", sensitive: true },
  { doctype: "Designation Skill", nodeType: "designation-skill" },
  { doctype: "Expected Skill Set", nodeType: "expected-skill-set" },
];

const TRAINING: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Training Program", nodeType: "training-program" },
  { doctype: "Training Event", nodeType: "training-event" },
  { doctype: "Training Event Employee", nodeType: "training-event-employee" },
  { doctype: "Training Feedback", nodeType: "training-feedback", sensitive: true },
  { doctype: "Training Result", nodeType: "training-result", sensitive: true },
  { doctype: "Training Result Employee", nodeType: "training-result-employee", sensitive: true },
  { doctype: "Employee Training", nodeType: "employee-training", sensitive: true },
];

const LIFECYCLE: Array<Partial<DoctypeMapping> & { doctype: string }> = [
  { doctype: "Employee Promotion", nodeType: "employee-promotion", sensitive: true },
  { doctype: "Employee Transfer", nodeType: "employee-transfer", sensitive: true },
  { doctype: "Employee Separation", nodeType: "employee-separation", sensitive: true },
  { doctype: "Employee Separation Template", nodeType: "employee-separation-template" },
  { doctype: "Exit Interview", nodeType: "exit-interview", sensitive: true },
  { doctype: "Full and Final Statement", nodeType: "full-and-final-statement", sensitive: true },
  { doctype: "Full and Final Asset", nodeType: "full-and-final-asset", sensitive: true },
  { doctype: "Full and Final Outstanding Statement", nodeType: "full-and-final-outstanding", sensitive: true },
  { doctype: "Employee Grievance", nodeType: "employee-grievance", sensitive: true },
  { doctype: "Grievance Type", nodeType: "grievance-type" },
  { doctype: "Employee Grade", nodeType: "employee-grade" },
  { doctype: "Employment Type", nodeType: "employment-type" },
  { doctype: "Employee Cost Center", nodeType: "employee-cost-center", sensitive: true },
  { doctype: "Department Approver", nodeType: "department-approver" },
  { doctype: "Daily Work Summary", nodeType: "daily-work-summary", sensitive: true },
  { doctype: "Daily Work Summary Group", nodeType: "daily-work-summary-group" },
  { doctype: "Daily Work Summary Group User", nodeType: "daily-work-summary-group-user" },
];

const ALL_GROUPS: Array<{ category: N1Category; items: Array<Partial<DoctypeMapping> & { doctype: string }> }> = [
  { category: "payroll", items: PAYROLL },
  { category: "recruitment", items: RECRUITMENT },
  { category: "leave", items: LEAVE },
  { category: "expense", items: EXPENSE },
  { category: "attendance", items: ATTENDANCE },
  { category: "performance", items: PERFORMANCE },
  { category: "training", items: TRAINING },
  { category: "lifecycle", items: LIFECYCLE },
];

function build(): {
  byDoctype: Map<string, DoctypeMapping>;
  byNodeType: Map<string, DoctypeMapping>;
  list: DoctypeMapping[];
} {
  const byDoctype = new Map<string, DoctypeMapping>();
  const byNodeType = new Map<string, DoctypeMapping>();
  const list: DoctypeMapping[] = [];
  for (const { category, items } of ALL_GROUPS) {
    for (const item of items) {
      const mapping: DoctypeMapping = {
        doctype: item.doctype,
        nodeType: item.nodeType ?? slug(item.doctype),
        category: item.category ?? category,
        idField: item.idField,
        sensitive: item.sensitive,
        fields: item.fields,
      };
      if (!byDoctype.has(mapping.doctype)) {
        byDoctype.set(mapping.doctype, mapping);
        list.push(mapping);
      }
      if (!byNodeType.has(mapping.nodeType)) byNodeType.set(mapping.nodeType, mapping);
    }
  }
  return { byDoctype, byNodeType, list };
}

const REGISTRY = build();

export const SUPPORTED_DOCTYPES: DoctypeMapping[] = REGISTRY.list;

export function mappingForDoctype(doctype: string): DoctypeMapping | undefined {
  return REGISTRY.byDoctype.get(doctype);
}

export function mappingForNodeType(nodeType: string): DoctypeMapping | undefined {
  return REGISTRY.byNodeType.get(nodeType);
}

export function doctypeForNodeType(nodeType: string): string | undefined {
  return REGISTRY.byNodeType.get(nodeType)?.doctype;
}

export function categoryForNodeType(nodeType: string): N1Category | undefined {
  return REGISTRY.byNodeType.get(nodeType)?.category;
}

export function isSensitiveNodeType(nodeType: string): boolean {
  return REGISTRY.byNodeType.get(nodeType)?.sensitive === true;
}

export function doctypesByCategory(category: N1Category): DoctypeMapping[] {
  return SUPPORTED_DOCTYPES.filter((m) => m.category === category);
}

/** Generic mapper used for every registry DocType: snake_case → camelCase + renames. */
export function applyFieldMap(record: N1Record, mapping: DoctypeMapping): {
  nodeType: string;
  nodeId: NodeId;
  data: RecordData;
} {
  const renames = mapping.fields ?? {};
  const data: RecordData = {};
  for (const [key, value] of Object.entries(record.data)) {
    const target = renames[key] ?? toCamel(key);
    if (!(target in data)) data[target] = value;
  }
  const id =
    (mapping.idField ? str(record.data[renames[mapping.idField] ?? mapping.idField]) : undefined) ??
    record.name;
  return { nodeType: mapping.nodeType, nodeId: id, data };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function toCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : undefined;
}
