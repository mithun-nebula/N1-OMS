import type { DomainContext } from "../types";
import { DEMO_PEOPLE } from "../shared/people-roster";
import {
  SUPPORTED_DOCTYPES,
  type DoctypeMapping,
} from "./n1-doctypes";
import type { RecordData } from "@/spine/record/types";

const PEOPLE = Object.entries(DEMO_PEOPLE).map(([id, p]) => ({ id, name: p.name }));
const PAYROLL_STATUSES = ["Submitted", "Draft", "Active", "Cancelled"];
const GENERIC_STATUSES = ["Active", "Open", "Pending", "Approved", "Completed", "Draft"];

function pick<T>(arr: T[], i: number): T { return arr[i % arr.length]; }
function date(s: number): string { return `2026-0${(s % 8) + 1}-${10 + (s % 18)}`; }
function amount(s: number, base: number): number { return base + (s * 137) % 9000; }

/**
 * Generate a realistic demo record for any mapped N1 DocType, category-aware.
 * Not a real Frappe record — plausible demo data so the /records browser is
 * never empty. Replaced by live N1 data when n1Mode() === "live".
 */
function generateRecord(m: DoctypeMapping, seq: number): RecordData {
  const person = pick(PEOPLE, seq);
  const d = date(seq);
  const status = pick(GENERIC_STATUSES, seq);

  const employeeFields = { employee: person.id, employeeName: person.name, company: "Organization A" };

  switch (m.category) {
    case "payroll":
      return {
        ...employeeFields,
        postingDate: d,
        currency: "INR",
        status: pick(PAYROLL_STATUSES, seq),
        ...payrollFields(m.doctype, seq),
      };
    case "recruitment":
      return {
        status: pick(GENERIC_STATUSES, seq),
        ...recruitmentFields(m.doctype, seq),
      };
    case "leave":
      return {
        ...employeeFields,
        leaveType: pick(["Casual Leave", "Sick Leave", "Earned Leave", "Compensatory Off"], seq),
        fromDate: d,
        toDate: d,
        status,
        ...leaveFields(m.doctype, seq),
      };
    case "expense":
      return {
        ...employeeFields,
        expenseDate: d,
        totalAmount: amount(seq, 2000),
        status,
        description: pick(["Client visit", "Team offsite", "Conference registration", "Equipment purchase", "Travel"], seq),
        ...expenseFields(m.doctype, seq),
      };
    case "attendance":
      return {
        ...employeeFields,
        ...attendanceFields(m.doctype, seq),
      };
    case "performance":
      return {
        ...employeeFields,
        appraisalCycle: pick(["2026 H1", "2026 H2"], seq),
        totalScore: 3 + (seq % 3) + (seq % 10) / 10,
        status,
        ...performanceFields(m.doctype, seq),
      };
    case "training":
      return {
        ...employeeFields,
        eventName: pick(["AI for Course Writing", "Advanced Pedagogy", "Leadership Essentials", "Data Storytelling"], seq),
        startDate: d,
        endDate: d,
        status,
        ...trainingFields(m.doctype, seq),
      };
    case "lifecycle":
      return {
        ...employeeFields,
        ...lifecycleFields(m.doctype, seq),
      };
  }
}

// ── category-specific field generators ──

function payrollFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  if (dt.includes("payslip") || dt.includes("slip"))
    return { grossPay: amount(s, 75000), netPay: amount(s, 63000), totalDeduction: amount(s, 12000), month: pick(["June 2026", "July 2026"], s) };
  if (dt.includes("structure") && !dt.includes("assignment"))
    return { name: "Standard Structure", totalEarning: amount(s, 80000), totalDeduction: amount(s, 12000) };
  if (dt.includes("component"))
    return { salaryComponent: pick(["Basic", "HRA", "Special Allowance", "PF", "Professional Tax", "TDS"], s), componentType: pick(["Earning", "Deduction"], s), amountBasedOn: "Monthly" };
  if (dt.includes("assignment"))
    return { salaryStructure: "Standard Structure", fromDate: date(s), base: amount(s, 50000) };
  if (dt.includes("income tax") || dt.includes("tax"))
    if (dt.includes("slab"))
      return { fromAmount: s * 50000, toAmount: (s + 1) * 50000, percent: pick([0, 5, 10, 15, 20, 30], s), fiscalYear: "2026-27" };
    else
      return { exemptionCategory: pick(["80C", "80D", "80E", "HRA"], s), declaredAmount: amount(s, 50000), proofSubmitted: s % 2 === 0 };
  if (dt.includes("gratuity"))
    return { amount: amount(s, 200000), yearsOfService: 5 + s, status: "Paid" };
  if (dt.includes("benefit"))
    return { benefitType: pick(["Medical Reimbursement", "LTA", "Fuel"], s), claimAmount: amount(s, 12000), status: "Submitted" };
  if (dt.includes("overtime"))
    return { overtimeHours: 2 + (s % 8), overtimeAmount: amount(s, 500), overtimeType: "Weekday" };
  if (dt.includes("withholding"))
    return { withholdingType: "Notice Period", status: "Active" };
  if (dt.includes("payroll") && dt.includes("correction"))
    return { correctionType: "Arrears", amount: amount(s, 3000), status: "Pending" };
  if (dt.includes("payroll") && dt.includes("entry"))
    return { postingDate: date(s), status: "Submitted", numberOfEmployees: 9 };
  if (dt.includes("period"))
    return { name: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31" };
  if (dt.includes("retention") || dt.includes("incentive") || dt.includes("arrear"))
    return { amount: amount(s, 15000), bonusType: doctype };
  if (dt.includes("salary") && dt.includes("detail"))
    return { componentName: "Basic", amount: amount(s, 40000), formula: "BASIC * 0.5" };
  if (dt.includes("settings"))
    return { payrollFrequency: "Monthly", defaultPayrollPayableAccount: "Payroll Payable" };
  return { amount: amount(s, 10000), type: doctype };
}

function recruitmentFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  const applicantNames = ["Anika R.", "Vikram S.", "Deepa M.", "Rahul K.", "Sneha P.", "Arjun N.", "Fatima A.", "Rohit G."];
  if (dt.includes("applicant"))
    return { applicantName: pick(applicantNames, s), emailAddress: `applicant${s}@example.com`, designation: "Course Writer", source: pick(["LinkedIn", "Referral", "Naukri", "Website"], s), status: pick(["Open", "Interview", "Offer", "Rejected"], s) };
  if (dt.includes("opening") && !dt.includes("template"))
    return { title: pick(["Course Writer", "Instructional Designer", "Content Reviewer", "L&D Manager"], s), designation: "Course Writer", status: "Open", company: "Organization A", description: "Build AI/ML training courses" };
  if (dt.includes("interview") && !dt.includes("feedback") && !dt.includes("type") && !dt.includes("detail"))
    return { applicant: pick(applicantNames, s), designation: "Course Writer", scheduledOn: date(s), interviewRound: pick(["Telephonic", "Technical", "HR", "Final"], s), status: pick(["Pending", "Completed"], s) };
  if (dt.includes("feedback"))
    return { applicant: pick(applicantNames, s), feedback: "Strong technical skills, good cultural fit.", rating: 4, result: pick(["Selected", "Rejected", "Hold"], s) };
  if (dt.includes("offer"))
    return { applicant: pick(applicantNames, s), offerDate: date(s), designation: "Course Writer", offeredCtc: amount(s, 800000), status: pick(["Pending", "Accepted", "Declined"], s) };
  if (dt.includes("term"))
    return { termName: pick(["Base Salary", "Joining Bonus", "PF", "Gratuity"], s), termValue: amount(s, 50000) };
  if (dt.includes("appointment"))
    return { applicant: pick(applicantNames, s), content: "We are pleased to offer you the position of Course Writer…" };
  if (dt.includes("template"))
    return { name: `${doctype} Template`, status: "Active" };
  if (dt.includes("requisition") || dt.includes("staffing"))
    return { designation: "Course Writer", requestedBy: "james", status: "Pending", expectedBy: date(s), noOfPositions: 1 + s };
  if (dt.includes("interviewer"))
    return { interviewer: pick(PEOPLE, s).id, interviewerName: pick(PEOPLE, s).name };
  if (dt.includes("skill") && dt.includes("assessment"))
    return { applicant: pick(applicantNames, s), skill: "Course Design", score: 3 + (s % 3) };
  if (dt.includes("referral"))
    return { referredBy: pick(PEOPLE, s).id, referredFor: pick(applicantNames, s), status: "Pending", bonusEligible: s % 2 === 0 };
  if (dt.includes("source"))
    return { sourceName: pick(["LinkedIn", "Naukri", "Employee Referral", "Website"], s) };
  if (dt.includes("boarding"))
    return { employee: pick(PEOPLE, s).id, activityName: "IT Setup", status: "Pending" };
  return { name: doctype, status: pick(GENERIC_STATUSES, s) };
}

function leaveFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  if (dt.includes("block"))
    return { blockListName: "Year-End Block", reason: "Year-end freeze", fromDate: "2026-12-20", toDate: "2026-12-31" };
  if (dt.includes("encashment"))
    return { leaveType: "Earned Leave", encashmentDays: 5 + s, encashmentAmount: amount(s, 8000), status: "Pending" };
  if (dt.includes("compensatory"))
    return { leaveDate: date(s), reason: "Worked on weekend", status: "Approved", halfDay: false };
  if (dt.includes("earned") && dt.includes("schedule"))
    return { leaveType: "Earned Leave", earnedDate: date(s), leavesEarned: 1.5 };
  if (dt.includes("adjustment"))
    return { leaveType: "Casual Leave", adjustmentDate: date(s), adjustmentType: pick(["Add", "Remove"], s), leaves: 1 };
  if (dt.includes("control"))
    return { leaveType: "Casual Leave", operation: "Allocate", status: "Active" };
  if (dt.includes("ledger"))
    return { leaveType: "Casual Leave", transactionType: pick(["Leave Allocation", "Leave Application", "Leave Cancellation"], s), leaves: 1, isExpired: false };
  if (dt.includes("policy") && !dt.includes("detail") && !dt.includes("assignment"))
    return { name: "Standard Leave Policy", status: "Active", leavePolicies: [] };
  if (dt.includes("policy") && dt.includes("assignment"))
    return { leavePolicy: "Standard Leave Policy", assignmentBasedOn: "Leave Period", status: "Active" };
  if (dt.includes("period"))
    return { name: "2026 Leave Period", fromDate: "2026-01-01", toDate: "2026-12-31", isActive: true };
  if (dt.includes("allocation"))
    return { leaveType: pick(["Casual Leave", "Sick Leave", "Earned Leave"], s), fromDate: "2026-01-01", toDate: "2026-12-31", totalLeaves: 12 + s, newLeavesAllocated: 12, status: "Active" };
  if (dt.includes("holiday"))
    return { name: "2026 Holidays", holidayDate: date(s), description: pick(["Republic Day", "Independence Day", "Gandhi Jayanti", "Diwali"], s) };
  if (dt.includes("type"))
    return { leaveTypeName: pick(["Casual Leave", "Sick Leave", "Earned Leave", "Compensatory Off"], s), isPaidLeave: 1, isLwp: 0, maxLeavesAllowed: 15, carryForward: 1 };
  return {};
}

function expenseFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  if (dt.includes("travel") && dt.includes("costing"))
    return { costingDate: date(s), expenseType: "Flight", amount: amount(s, 15000) };
  if (dt.includes("travel") && dt.includes("itinerary"))
    return { itineraryDate: date(s), fromLocation: "Mumbai", toLocation: "Bengaluru", modeOfTravel: "Flight" };
  if (dt.includes("travel") && dt.includes("purpose"))
    return { purposeName: "Client Meeting" };
  if (dt.includes("travel"))
    return { fromDate: date(s), toDate: date(s), estimatedAmount: amount(s, 20000), purpose: "Client visit", status: "Approved", travelType: "Domestic" };
  if (dt.includes("advance"))
    return { advanceAmount: amount(s, 10000), purpose: "Conference travel", status: pick(["Unpaid", "Paid", "Claimed"], s), balanceAmount: amount(s, 2000) };
  if (dt.includes("taxes"))
    return { taxType: "GST", taxAmount: amount(s, 500), rate: 18 };
  if (dt.includes("vehicle") && dt.includes("log"))
    return { licensePlate: `MH-0${1 + s % 9}-AB-00${s + 1}`, date: date(s), odometer: 10000 + s * 100, selectedDriver: pick(PEOPLE, s).id };
  if (dt.includes("vehicle") && dt.includes("service"))
    return { serviceDate: date(s), serviceType: pick(["Periodic", "Repair", "Insurance"], s), status: "Completed" };
  if (dt.includes("vehicle") && dt.includes("item"))
    return { itemName: pick(["Oil Change", "Brake Pads", "Tyre Rotation", "Battery"], s), amount: amount(s, 3000) };
  if (dt.includes("detail"))
    return { expenseType: pick(["Travel", "Food", "Accommodation", "Miscellaneous"], s), amount: amount(s, 2000), description: "Business expense" };
  if (dt.includes("account"))
    return { accountName: "Travel Expenses", debit: amount(s, 5000), credit: 0 };
  if (dt.includes("claim") && dt.includes("type"))
    return { name: pick(["Travel", "Food", "Fuel", "Internet", "Stationery"], s) };
  return {};
}

function attendanceFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  if (dt.includes("checkin"))
    return { logType: pick(["IN", "OUT"], s), time: `${date(s)} ${pick(["09:25:00", "18:35:00", "09:40:00", "18:10:00"], s)}`, shift: "General", deviceId: "Biometric-01" };
  if (dt.includes("shift") && dt.includes("type"))
    return { shiftTypeName: pick(["General", "Night", "Flexible"], s), startTime: "09:30:00", endTime: "18:30:00", gracePeriod: 15, status: "Active" };
  if (dt.includes("shift") && dt.includes("assignment"))
    return { shiftType: "General", startDate: date(s), status: "Active" };
  if (dt.includes("shift") && dt.includes("request"))
    return { shiftType: "General", fromDate: date(s), toDate: date(s), reason: "Personal", status: pick(["Pending", "Approved"], s) };
  if (dt.includes("shift") && dt.includes("location"))
    return { locationName: pick(["Mumbai HQ", "Bengaluru Office", "Pune Branch"], s), status: "Active" };
  if (dt.includes("shift") && dt.includes("schedule"))
    return { scheduleName: "Standard Weekly", startTime: "09:30:00", endTime: "18:30:00", status: "Active" };
  if (dt.includes("attendance") && dt.includes("request"))
    return { fromDate: date(s), toDate: date(s), reason: pick(["Missed Punch", "WFH", "Official Duty"], s), status: pick(["Pending", "Approved"], s) };
  if (dt.includes("attendance") && dt.includes("tool"))
    return { status: "Active" };
  if (dt.includes("upload"))
    return { fileName: "attendance_aug2026.csv", status: "Uploaded" };
  if (dt.includes("holiday") && dt.includes("assignment"))
    return { holidayList: "2026 Holidays", fromDate: date(s) };
  return { attendanceDate: date(s), status: pick(["Present", "Absent", "Work From Home", "Half Day"], s), inTime: "09:30:00", outTime: "18:30:00" };
}

function performanceFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  if (dt.includes("appraisal") && !dt.includes("template") && !dt.includes("goal") && !dt.includes("kra") && !dt.includes("cycle"))
    return { finalScore: 3 + (s % 3) + 0.2, selfScore: 3.5 + (s % 2), managerScore: 3 + (s % 3), status: pick(["Draft", "Submitted", "Completed"], s) };
  if (dt.includes("cycle"))
    return { cycleName: pick(["2026 H1", "2026 H2"], s), status: "Open", startDate: "2026-01-01", endDate: "2026-06-30" };
  if (dt.includes("template"))
    return { templateName: "Standard Appraisal", totalKras: 5, status: "Active" };
  if (dt.includes("goal") && !dt.includes("template"))
    return { goalName: pick(["Publish 12 courses", "Reduce review time to 3 days", "Onboard 3 writers"], s), progress: (s * 17) % 100, status: pick(["In Progress", "Achieved", "Overdue"], s), weightage: 20 };
  if (dt.includes("kra"))
    return { kraName: pick(["Course Quality", "Team Productivity", "Innovation", "Process Improvement"], s), weightage: 25, status: "Active" };
  if (dt.includes("feedback") && !dt.includes("criteria") && !dt.includes("rating"))
    return { feedback: "Consistently delivers high-quality work. Good collaboration.", rating: 4, reviewer: pick(PEOPLE, s).id, status: "Submitted" };
  if (dt.includes("criteria"))
    return { criteriaName: pick(["Technical Skills", "Communication", "Ownership", "Teamwork"], s), weight: 25 };
  if (dt.includes("rating"))
    return { rating: 3 + (s % 3), criteria: "Technical Skills", status: "Submitted" };
  if (dt.includes("skill") && !dt.includes("map") && !dt.includes("designation") && !dt.includes("expected"))
    return { skillName: pick(["Course Design", "Content Writing", "AI Tools", "Data Analysis", "Project Management"], s), skillDescription: "Core competency", status: "Active" };
  if (dt.includes("skill") && dt.includes("map"))
    return { designation: "Course Writer", skills: [], status: "Active" };
  if (dt.includes("designation") && dt.includes("skill"))
    return { designation: "Course Writer", skill: "Course Design", proficiencyLevel: pick(["Beginner", "Intermediate", "Expert"], s) };
  if (dt.includes("expected"))
    return { designation: "Course Writer", expectedSkills: [], minimumProficiency: "Intermediate" };
  if (dt.includes("appraisee"))
    return { employee: pick(PEOPLE, s).id, employeeName: pick(PEOPLE, s).name, status: "Active" };
  return {};
}

function trainingFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  if (dt.includes("program"))
    return { programName: pick(["AI for Course Writing", "Advanced Pedagogy", "Leadership Essentials", "Data Storytelling"], s), description: "Professional development program", status: "Active" };
  if (dt.includes("event") && !dt.includes("employee"))
    return { course: pick(["AI for Course Writing", "Advanced Pedagogy"], s), location: pick(["Mumbai HQ", "Online"], s), status: pick(["Scheduled", "Completed"], s), trainer: pick(PEOPLE, s).name };
  if (dt.includes("employee"))
    return { status: pick(["Mandatory", "Optional"], s), attendance: pick(["Attended", "Absent"], s) };
  if (dt.includes("feedback"))
    return { feedback: "Very useful, practical examples.", rating: 4 + (s % 2), status: "Submitted" };
  if (dt.includes("result"))
    return { result: pick(["Pass", "Fail"], s), score: 70 + (s * 5) % 30, status: "Completed" };
  if (dt.includes("training") && !dt.includes("program") && !dt.includes("event") && !dt.includes("feedback") && !dt.includes("result"))
    return { trainingType: pick(["Technical", "Soft Skills", "Leadership"], s), status: "Completed", durationHours: 8 };
  return {};
}

function lifecycleFields(doctype: string, s: number): RecordData {
  const dt = doctype.toLowerCase();
  if (dt.includes("promotion"))
    return { promotionDate: date(s), oldDesignation: "Junior Writer", newDesignation: "Senior Writer", oldCtc: amount(s, 500000), newCtc: amount(s, 700000), status: "Approved" };
  if (dt.includes("transfer"))
    return { transferDate: date(s), oldDepartment: "Courses", newDepartment: "Operations", oldReportingManager: "james", newReportingManager: "shruti", status: "Approved" };
  if (dt.includes("separation") && !dt.includes("template"))
    return { separationType: pick(["Resignation", "Termination", "Retirement"], s), resignationLetterDate: date(s), relievedOn: date(s + 1), status: "Closed" };
  if (dt.includes("separation") && dt.includes("template"))
    return { templateName: "Standard Separation", tasks: [], status: "Active" };
  if (dt.includes("exit") && dt.includes("interview"))
    return { interviewDate: date(s), reasonForLeaving: pick(["Career growth", "Relocation", "Better opportunity"], s), feedback: "Positive experience.", status: "Completed" };
  if (dt.includes("full") && dt.includes("final") && dt.includes("statement"))
    return { totalReceivable: amount(s, 50000), totalPayable: amount(s, 12000), netAmount: amount(s, 38000), status: "Pending" };
  if (dt.includes("full") && dt.includes("final") && dt.includes("asset"))
    return { assetName: "MacBook Pro", assetStatus: pick(["Returned", "Pending"], s) };
  if (dt.includes("full") && dt.includes("final") && dt.includes("outstanding"))
    return { outstandingType: "Salary Advance", amount: amount(s, 10000), status: "Pending" };
  if (dt.includes("grievance") && !dt.includes("type"))
    return { grievanceType: pick(["Workplace", "Compensation", "Management"], s), description: "Concern about workload distribution.", status: pick(["Open", "Investigating", "Resolved"], s), filedOn: date(s), priority: pick(["Low", "Medium", "High"], s) };
  if (dt.includes("grievance") && dt.includes("type"))
    return { typeName: pick(["Workplace", "Compensation", "Harassment", "Management"], s), status: "Active" };
  if (dt.includes("grade"))
    return { gradeName: pick(["A1", "A2", "B1", "B2", "C1"], s), defaultLeavePolicy: "Standard Leave Policy", defaultBasePay: amount(s, 50000), status: "Active" };
  if (dt.includes("employment") && dt.includes("type"))
    return { typeName: pick(["Full-time", "Part-time", "Contract", "Intern"], s), status: "Active" };
  if (dt.includes("cost") && dt.includes("center"))
    return { costCenter: "Courses - Content", allocationPercentage: 100, status: "Active" };
  if (dt.includes("department") && dt.includes("approver"))
    return { approver: pick(PEOPLE, s).id, approverName: pick(PEOPLE, s).name, department: "Courses", doctype: "Leave Application" };
  if (dt.includes("daily") && dt.includes("work"))
    return { workSummary: "Completed 3 modules, reviewed 2 drafts.", status: "Submitted", submittedOn: date(s) };
  if (dt.includes("group") && !dt.includes("user"))
    return { groupName: "Course Writers", status: "Active" };
  if (dt.includes("group") && dt.includes("user"))
    return { user: pick(PEOPLE, s).id, groupName: "Course Writers" };
  return { type: doctype, status: pick(GENERIC_STATUSES, s) };
}

/**
 * Seeds demo N1 records for every mapped DocType that has no data yet.
 * Idempotent per-type: only fills gaps, never overwrites. Called from bootstrap
 * on every boot — runs once per type (first boot), then the data persists.
 */
export async function seedN1DemoIfEmpty(ctx: DomainContext): Promise<void> {
  let seq = 0;
  for (const mapping of SUPPORTED_DOCTYPES) {
    const existing = await ctx.graph.find(mapping.nodeType, () => true);
    if (existing.length > 0) continue;
    const data = generateRecord(mapping, seq);
    const id = `${mapping.nodeType}-demo`;
    await ctx.graph.putNode(mapping.nodeType, id, data);
    seq += 1;
  }
}
