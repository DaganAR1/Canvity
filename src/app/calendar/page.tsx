import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import CalendarMonth from "@/components/CalendarMonth";
import TimezoneSync from "@/components/TimezoneSync";
import AutoSync from "@/components/AutoSync";
import { buildMonthGrid, CalendarItem, parseMonthParam } from "@/lib/calendar";
import { partsFromDayIndex, safeTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { month: monthParam } = await searchParams;

  const [user, canvasAccount] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { timeZone: true } }),
    prisma.canvasAccount.findUnique({
      where: { userId: session.user.id },
      select: { lastSyncedAt: true },
    }),
  ]);
  const timeZone = safeTimeZone(user?.timeZone);
  const { year, month } = parseMonthParam(monthParam, timeZone);

  // Build an empty grid first so the query only has to cover the days actually
  // on screen, padding rows included.
  const bounds = buildMonthGrid(year, month, timeZone, []);
  const rangeStart = toUtcDate(bounds.startDayIndex, -1);
  const rangeEnd = toUtcDate(bounds.endDayIndex, 2);

  const courseScope = { canvasAccount: { userId: session.user.id }, isActive: true };

  const [assignments, syllabusItems, studyBlocks] = await Promise.all([
    prisma.assignment.findMany({
      where: { course: courseScope, dueAt: { gte: rangeStart, lte: rangeEnd } },
      include: { course: { select: { name: true, courseCode: true } } },
    }),
    prisma.syllabusItem.findMany({
      where: { course: courseScope, date: { gte: rangeStart, lte: rangeEnd } },
      include: { course: { select: { name: true, courseCode: true } } },
    }),
    prisma.studyBlock.findMany({
      where: { userId: session.user.id, startAt: { gte: rangeStart, lte: rangeEnd } },
      include: { assignment: { select: { name: true } } },
    }),
  ]);

  const items: CalendarItem[] = [
    ...assignments.map((a) => ({
      id: `assignment:${a.id}`,
      source: "assignment" as const,
      title: a.name,
      courseName: a.course.name,
      courseCode: a.course.courseCode,
      date: a.dueAt?.toISOString() ?? null,
      isAllDay: a.isAllDay,
      priorityTier: a.hasSubmitted ? "done" : a.priorityTier,
      isDone: a.hasSubmitted,
      url: a.htmlUrl,
    })),
    ...syllabusItems.map((s) => ({
      id: `syllabus:${s.id}`,
      source: "syllabus" as const,
      title: s.title,
      courseName: s.course.name,
      courseCode: s.course.courseCode,
      date: s.date?.toISOString() ?? null,
      isAllDay: s.isAllDay,
      priorityTier: s.priorityTier,
      isDone: false,
      url: null,
    })),
    ...studyBlocks.map((b) => ({
      id: `study:${b.id}`,
      source: "study" as const,
      title: b.title ?? (b.assignment ? `Study: ${b.assignment.name}` : "Study block"),
      courseName: null,
      courseCode: null,
      date: b.startAt.toISOString(),
      endDate: b.endAt.toISOString(),
      isAllDay: false,
      priorityTier: b.status === "done" ? "done" : "normal",
      isDone: b.status === "done",
      url: null,
    })),
  ];

  const grid = buildMonthGrid(year, month, timeZone, items);
  const hasAnything = assignments.length + syllabusItems.length + studyBlocks.length > 0;

  return (
    <>
      <TimezoneSync storedTimeZone={user?.timeZone ?? "UTC"} />
      {canvasAccount && (
        <AutoSync lastSyncedAt={canvasAccount.lastSyncedAt?.toISOString() ?? null} />
      )}
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <CalendarMonth grid={grid} timeZone={timeZone} />

        {!hasAnything && (
          <p className="mt-6 text-center text-sm text-[var(--muted)]">
            Nothing here yet.{" "}
            <Link href="/settings" className="text-blue-600 hover:underline">
              Connect Canvas
            </Link>{" "}
            and sync to fill this in.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 rounded-full bg-red-500" /> Critical
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 rounded-full bg-orange-500" /> High
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 rounded-full bg-blue-500" /> Normal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 rounded-full bg-slate-400" /> Low
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 rounded-full bg-green-500" /> Done
          </span>
        </div>
      </main>
    </>
  );
}

/**
 * Day index to a UTC instant, with a day of slack on each end. The grid's
 * bounds are calendar days in the viewer's zone, which can reach up to a day
 * either side of the same dates in UTC — the padding keeps an item near the
 * edge from being filtered out of the query before it can be placed.
 */
function toUtcDate(dayIndex: number, dayOffset: number): Date {
  const { year, month, day } = partsFromDayIndex(dayIndex + dayOffset);
  return new Date(Date.UTC(year, month - 1, day));
}
