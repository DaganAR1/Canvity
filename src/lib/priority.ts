// Turns a Canvas assignment's raw attributes into a single priority score and
// a human-friendly tier, so the timeline can be sorted by "what actually
// needs attention first" instead of just chronological due date.
//
// Urgency (how soon it's due) sets the scale of the score; importance (how
// much it's worth) modulates the amplitude. Keeping the two separate is what
// stops a trivial assignment due today from outranking a midterm due tomorrow.

export interface PriorityInput {
  dueAt: Date | null;
  pointsPossible: number | null;
  groupWeight: number | null; // 0-100, % of course grade the assignment's group is worth
  hasSubmitted: boolean;
  courseWeight: number; // user-adjustable multiplier, default 1.0 (0.5 - 2.0 typical range)
  now?: Date;
}

export type PriorityTier = "critical" | "high" | "normal" | "low" | "done";

export interface PriorityResult {
  score: number;
  tier: PriorityTier;
  daysUntilDue: number | null;
}

const BASE_HALF_LIFE_DAYS = 3;
const HALF_LIFE_IMPORTANCE_BOOST = 3; // a max-importance item decays 4x slower than a trivial one
const URGENCY_FLOOR = 4; // keeps far-future work orderable instead of collapsing to zero
const NO_DUE_DATE_URGENCY = 5; // no deadline = no time pressure, but still on the radar

// Importance never drops the score below this fraction of urgency, so a
// deadline that is genuinely imminent still surfaces even if it's worth little.
const IMPORTANCE_FLOOR = 0.45;

// Bigger assignments need more runway, so their urgency decays more slowly and
// they climb the list days earlier than a quiz worth the same score today would.
function computeUrgency(daysUntilDue: number | null, importance: number): number {
  if (daysUntilDue === null) return NO_DUE_DATE_URGENCY;
  if (daysUntilDue <= 0) return 100; // overdue or due right now

  const halfLife = BASE_HALF_LIFE_DAYS * (1 + (importance / 100) * HALF_LIFE_IMPORTANCE_BOOST);
  const decay = Math.exp((-daysUntilDue * Math.LN2) / halfLife);
  return Math.max(URGENCY_FLOOR, Math.min(100, decay * 100));
}

/** 0-100: how much this assignment matters to the final grade. */
function computeImportance(pointsPossible: number | null, groupWeight: number | null): number {
  const pointsNorm = pointsPossible !== null ? Math.min(100, (Math.min(pointsPossible, 200) / 200) * 100) : 40;

  // A group weight is the truest signal of impact on the final grade, so lean
  // on it when the course defines one and fall back to raw points otherwise.
  if (groupWeight !== null && groupWeight > 0) {
    return 0.7 * Math.min(100, groupWeight) + 0.3 * pointsNorm;
  }
  return pointsNorm;
}

export function computePriority(input: PriorityInput): PriorityResult {
  const now = input.now ?? new Date();
  const daysUntilDue = diffInDays(input.dueAt, now);

  if (input.hasSubmitted) {
    return { score: 0, tier: "done", daysUntilDue };
  }

  // The user's course weight scales importance only, so marking a course
  // "high" can't by itself promote busywork above a real deadline.
  const importance = Math.min(
    100,
    computeImportance(input.pointsPossible, input.groupWeight) * clampWeight(input.courseWeight)
  );

  const urgency = computeUrgency(daysUntilDue, importance);
  const amplitude = IMPORTANCE_FLOOR + (1 - IMPORTANCE_FLOOR) * (importance / 100);
  const score = Math.round(Math.max(0, Math.min(100, urgency * amplitude)) * 10) / 10;

  return { score, tier: scoreToTier(score, daysUntilDue), daysUntilDue };
}

function diffInDays(dueAt: Date | null, now: Date): number | null {
  if (!dueAt) return null;
  return (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
}

function clampWeight(weight: number): number {
  if (Number.isNaN(weight)) return 1;
  return Math.max(0.5, Math.min(2, weight));
}

function scoreToTier(score: number, daysUntilDue: number | null): PriorityTier {
  if (daysUntilDue !== null && daysUntilDue < 0) return "critical"; // overdue and still unsubmitted
  if (score >= 65) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "normal";
  return "low";
}
