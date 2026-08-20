// Groups everything due into the buckets the timeline renders. Entries come
// from two places — Canvas assignments and dated items pulled out of a course
// syllabus — and share one ordering so a syllabus-only exam can't hide behind
// the assignment list.

import { dayIndexInZone, dayIndexOfAllDay } from "@/lib/timezone";

export interface TimelineEntry {
  id: string;
  source: "assignment" | "syllabus";
  name: string;
  url: string | null;
  date: string | null;
  /**
   * True for a syllabus item extracted with no time of day ("Oct 3", not
   * "Oct 3 at 2pm") — it names a calendar date, not an instant, and is bucketed
   * and formatted accordingly. Always false for Canvas assignments, whose
   * due_at is already a real, timezone-resolved instant.
   */
  isAllDay: boolean;
  /** Assignments only. */
  pointsPossible: number | null;
  /** Syllabus items only: what kind of thing it is, and any extra specifics. */
  syllabusKind: string | null;
  detail: string | null;
  priorityScore: number;
  priorityTier: string;
  course: { id: string; name: string; courseCode: string | null };
}

export type BucketKey = "overdue" | "today" | "tomorrow" | "this_week" | "next_week" | "later" | "no_due_date";

export interface TimelineBucket {
  key: BucketKey;
  label: string;
  entries: TimelineEntry[];
}

const BUCKET_ORDER: { key: BucketKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "tomorrow", label: "Due tomorrow" },
  { key: "this_week", label: "Rest of this week" },
  { key: "next_week", label: "Next week" },
  { key: "later", label: "Later" },
  { key: "no_due_date", label: "No due date" },
];

/**
 * Buckets by whole calendar days in the viewer's zone rather than by elapsed
 * hours, so a deadline at 11pm tonight reads "today" and one just after
 * midnight reads "tomorrow" — and DST transitions, which make some local days
 * 23 or 25 hours long, can't shift anything into the wrong bucket.
 */
export function bucketFor(
  entry: { date: string | null; isAllDay?: boolean },
  now: Date,
  timeZone: string
): BucketKey {
  if (!entry.date) return "no_due_date";

  const due = new Date(entry.date);
  if (Number.isNaN(due.getTime())) return "no_due_date";

  const todayIndex = dayIndexInZone(now, timeZone);
  // A date-only value names a calendar date, so it is read in UTC; a timed one
  // is a real instant and is read in the viewer's zone.
  const dueIndex = entry.isAllDay ? dayIndexOfAllDay(due) : dayIndexInZone(due, timeZone);
  const daysOut = dueIndex - todayIndex;

  // An all-day item has no hour to be past, so it stays current until the day
  // itself has gone by. A timed one is overdue the moment it passes.
  if (entry.isAllDay ? daysOut < 0 : due.getTime() < now.getTime()) return "overdue";

  if (daysOut <= 0) return "today";
  if (daysOut === 1) return "tomorrow";
  if (daysOut < 7) return "this_week";
  if (daysOut < 14) return "next_week";
  return "later";
}

export function buildTimeline(
  entries: TimelineEntry[],
  timeZone: string,
  now: Date = new Date()
): TimelineBucket[] {
  const byBucket = new Map<BucketKey, TimelineEntry[]>();

  for (const entry of entries) {
    const key = bucketFor(entry, now, timeZone);
    const list = byBucket.get(key) ?? [];
    list.push(entry);
    byBucket.set(key, list);
  }

  return BUCKET_ORDER.map(({ key, label }) => ({
    key,
    label,
    entries: (byBucket.get(key) ?? []).sort((a, b) => b.priorityScore - a.priorityScore),
  })).filter((bucket) => bucket.entries.length > 0);
}
