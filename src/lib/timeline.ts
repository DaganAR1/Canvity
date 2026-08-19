// Groups assignments into the buckets the timeline renders.

export interface TimelineAssignment {
  id: string;
  name: string;
  htmlUrl: string | null;
  dueAt: string | null;
  pointsPossible: number | null;
  hasSubmitted: boolean;
  priorityScore: number;
  priorityTier: string;
  course: { id: string; name: string; courseCode: string | null };
}

export type BucketKey = "overdue" | "today" | "tomorrow" | "this_week" | "next_week" | "later" | "no_due_date";

export interface TimelineBucket {
  key: BucketKey;
  label: string;
  assignments: TimelineAssignment[];
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

export function buildTimeline(assignments: TimelineAssignment[], now: Date = new Date()): TimelineBucket[] {
  const byBucket = new Map<BucketKey, TimelineAssignment[]>();

  for (const a of assignments) {
    if (a.hasSubmitted) continue;
    const key = bucketFor(a.dueAt ? new Date(a.dueAt) : null, now);
    const list = byBucket.get(key) ?? [];
    list.push(a);
    byBucket.set(key, list);
  }

  return BUCKET_ORDER.map(({ key, label }) => ({
    key,
    label,
    assignments: (byBucket.get(key) ?? []).sort((a, b) => b.priorityScore - a.priorityScore),
  })).filter((bucket) => bucket.assignments.length > 0);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
