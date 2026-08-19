// Groups everything due into the buckets the timeline renders. Entries come
// from two places — Canvas assignments and dated items pulled out of a course
// syllabus — and share one ordering so a syllabus-only exam can't hide behind
// the assignment list.

export interface TimelineEntry {
  id: string;
  source: "assignment" | "syllabus";
  name: string;
  url: string | null;
  date: string | null;
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

export function bucketFor(dueAt: Date | null, now: Date): BucketKey {
  if (!dueAt) return "no_due_date";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = addDays(startOfToday, 1);
  const startOfDayAfter = addDays(startOfToday, 2);
  const startOfNextWeek = addDays(startOfToday, 7);
  const startOfWeekAfter = addDays(startOfToday, 14);

  if (dueAt < now) return "overdue";
  if (dueAt < startOfTomorrow) return "today";
  if (dueAt < startOfDayAfter) return "tomorrow";
  if (dueAt < startOfNextWeek) return "this_week";
  if (dueAt < startOfWeekAfter) return "next_week";
  return "later";
}

export function buildTimeline(entries: TimelineEntry[], now: Date = new Date()): TimelineBucket[] {
  const byBucket = new Map<BucketKey, TimelineEntry[]>();

  for (const entry of entries) {
    const key = bucketFor(entry.date ? new Date(entry.date) : null, now);
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

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
