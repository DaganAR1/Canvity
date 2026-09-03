// Turns "here's what's due" into "here's when you're going to do it".
//
// The scheduler is deliberately deterministic — no model call. Everything it
// needs (deadlines, priority, effort estimates) is already known, and a plan
// that reshuffles unpredictably between runs is worse than one a student can
// reason about. A model earns its place upstream, estimating how long a piece
// of work takes; that estimate is an input here, not a decision made here.

import { dayIndexFromParts, getZonedParts, zonedTimeToUtc } from "@/lib/timezone";

export interface StudyPreferenceInput {
  weeklyTargetHours: number;
  sessionMinutes: number;
  breakMinutes: number;
  maxHoursPerDay: number;
  earliestHour: number;
  latestHour: number;
  peakStartHour: number;
  peakEndHour: number;
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. */
  studyDays: number[];
  finishAheadHours: number;
}

export interface WorkItem {
  id: string;
  kind: "assignment" | "syllabus";
  title: string;
  courseName: string;
  dueAt: Date;
  /** 0-100 from the priority scorer; drives peak-hour placement and tie-breaks. */
  priorityScore: number;
  estimatedMinutes: number;
}

export interface PlannedBlock {
  itemId: string;
  kind: "assignment" | "syllabus";
  title: string;
  courseName: string;
  startAt: Date;
  endAt: Date;
}

export interface UnscheduledItem {
  itemId: string;
  title: string;
  /** Minutes of work that wouldn't fit before the deadline. */
  missingMinutes: number;
  reason: "past_deadline" | "out_of_capacity";
}

export interface StudyPlan {
  blocks: PlannedBlock[];
  /**
   * Work that could not be placed. Surfacing this is the point: a student who
   * has genuinely overcommitted should be told, not handed a tidy plan that
   * quietly drops half their coursework.
   */
  unscheduled: UnscheduledItem[];
}

interface Slot {
  startAt: Date;
  endAt: Date;
  dayIndex: number;
  /** Local start hour, used to decide whether this is peak focus time. */
  localHour: number;
  isPeak: boolean;
}

/** Work at or above this score is treated as "hard" and steered into peak hours. */
const PEAK_PRIORITY_THRESHOLD = 65;

/**
 * Rough effort estimate from what Canvas already tells us. Points are a
 * surprisingly decent proxy — a 100-point essay really is a different kind of
 * task than a 10-point reading check — but this is the weakest link in the
 * plan, and the piece a model replaces first.
 */
export function estimateMinutes(input: {
  pointsPossible: number | null;
  kind?: string | null;
  sessionMinutes: number;
}): number {
  const { pointsPossible, kind, sessionMinutes } = input;

  let minutes: number;
  if (pointsPossible !== null && pointsPossible > 0) {
    minutes = 30 + pointsPossible * 2.5;
  } else {
    // No point value: fall back on what kind of thing it is.
    minutes =
      {
        exam: 240,
        project: 240,
        quiz: 60,
        reading: 45,
        assignment: 90,
        deadline: 30,
      }[kind ?? "assignment"] ?? 90;
  }

  minutes = Math.max(30, Math.min(480, minutes));
  // Round up to whole sessions so blocks never end mid-session.
  return Math.ceil(minutes / sessionMinutes) * sessionMinutes;
}

/** ISO weekday (1 = Monday .. 7 = Sunday) for a calendar date. */
function isoWeekday(year: number, month: number, day: number): number {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

/**
 * Every session-sized slot the student said they're willing to work in, over
 * the planning horizon, in chronological order. Slots are built from local
 * wall-clock hours so a plan reads correctly in the student's own day.
 */
function buildSlots(
  now: Date,
  prefs: StudyPreferenceInput,
  timeZone: string,
  horizonDays: number
): Slot[] {
  const slots: Slot[] = [];
  const today = getZonedParts(now, timeZone);
  const step = prefs.sessionMinutes + prefs.breakMinutes;

  for (let offset = 0; offset < horizonDays; offset++) {
    // Date.UTC normalizes month/day overflow, so adding days is safe here.
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();

    if (!prefs.studyDays.includes(isoWeekday(year, month, day))) continue;

    for (
      let minuteOfDay = prefs.earliestHour * 60;
      minuteOfDay + prefs.sessionMinutes <= prefs.latestHour * 60;
      minuteOfDay += step
    ) {
      const hour = Math.floor(minuteOfDay / 60);
      const minute = minuteOfDay % 60;
      const startAt = zonedTimeToUtc(year, month, day, hour, minute, timeZone);
      const endAt = new Date(startAt.getTime() + prefs.sessionMinutes * 60_000);

      if (startAt <= now) continue; // never schedule into the past

      slots.push({
        startAt,
        endAt,
        dayIndex: dayIndexFromParts(year, month, day),
        localHour: hour,
        isPeak: hour >= prefs.peakStartHour && hour < prefs.peakEndHour,
      });
    }
  }

  return slots;
}

/**
 * Places work into free slots, earliest deadline first.
 *
 * Earliest-deadline-first with earliest-fit placement front-loads the plan,
 * which is the opposite of how students naturally schedule and the entire
 * point of the feature. Within that, hard work is steered toward the hours the
 * student says they focus best, and routine work is steered away from them so
 * those hours stay available.
 */
export function planStudyBlocks(
  items: WorkItem[],
  prefs: StudyPreferenceInput,
  timeZone: string,
  now: Date = new Date(),
  horizonDays = 14
): StudyPlan {
  const slots = buildSlots(now, prefs, timeZone, horizonDays);
  const taken = new Array<boolean>(slots.length).fill(false);

  const minutesPerDay = new Map<number, number>();
  const weeklyCapMinutes = prefs.weeklyTargetHours * 60;
  const dailyCapMinutes = prefs.maxHoursPerDay * 60;
  let scheduledMinutes = 0;

  const ordered = [...items].sort(
    (a, b) => a.dueAt.getTime() - b.dueAt.getTime() || b.priorityScore - a.priorityScore
  );

  const blocks: PlannedBlock[] = [];
  const unscheduled: UnscheduledItem[] = [];

  for (const item of ordered) {
    // Finish with a buffer before the real deadline, not at the last minute.
    const deadline = new Date(item.dueAt.getTime() - prefs.finishAheadHours * 3_600_000);
    let remaining = item.estimatedMinutes;

    if (deadline <= now) {
      unscheduled.push({
        itemId: item.id,
        title: item.title,
        missingMinutes: remaining,
        reason: "past_deadline",
      });
      continue;
    }

    const isHard = item.priorityScore >= PEAK_PRIORITY_THRESHOLD;

    // Candidate slots, ordered by day first so the plan stays front-loaded,
    // then by whether the slot's focus quality matches the work's difficulty.
    const candidates = slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.endAt <= deadline)
      .sort((a, b) => {
        if (a.slot.dayIndex !== b.slot.dayIndex) return a.slot.dayIndex - b.slot.dayIndex;
        const aFit = isHard ? (a.slot.isPeak ? 0 : 1) : a.slot.isPeak ? 1 : 0;
        const bFit = isHard ? (b.slot.isPeak ? 0 : 1) : b.slot.isPeak ? 1 : 0;
        if (aFit !== bFit) return aFit - bFit;
        return a.slot.startAt.getTime() - b.slot.startAt.getTime();
      });

    for (const { slot, index } of candidates) {
      if (remaining <= 0) break;
      if (taken[index]) continue;
      if (scheduledMinutes + prefs.sessionMinutes > weeklyCapMinutes) break;

      const dayUsed = minutesPerDay.get(slot.dayIndex) ?? 0;
      if (dayUsed + prefs.sessionMinutes > dailyCapMinutes) continue;

      taken[index] = true;
      minutesPerDay.set(slot.dayIndex, dayUsed + prefs.sessionMinutes);
      scheduledMinutes += prefs.sessionMinutes;
      remaining -= prefs.sessionMinutes;

      blocks.push({
        itemId: item.id,
        kind: item.kind,
        title: item.title,
        courseName: item.courseName,
        startAt: slot.startAt,
        endAt: slot.endAt,
      });
    }

    if (remaining > 0) {
      unscheduled.push({
        itemId: item.id,
        title: item.title,
        missingMinutes: remaining,
        reason: "out_of_capacity",
      });
    }
  }

  blocks.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return { blocks, unscheduled };
}
