export const STAGES = ["outline", "draft", "review", "published"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_THRESHOLD_DAYS: Record<Exclude<Stage, "published">, number> = {
  outline: 14,
  draft: 21,
  review: 8,
};

const VALID_TRANSITIONS: Record<Stage, Stage[]> = {
  outline: ["draft"],
  draft: ["review", "outline"],
  review: ["published", "draft"],
  published: [],
};

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

export function normalizeStage(value: string): string {
  return String(value ?? "").toLowerCase().trim();
}

export function isValidTransition(from: string, to: string): boolean {
  const f = normalizeStage(from);
  const t = normalizeStage(to);
  if (!isStage(f) || !isStage(t)) return false;
  return VALID_TRANSITIONS[f].includes(t);
}

export function nextStages(from: string): Stage[] {
  const f = normalizeStage(from);
  if (!isStage(f)) return [];
  return VALID_TRANSITIONS[f];
}
