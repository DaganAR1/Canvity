import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import Timeline from "@/components/Timeline";
import TimezoneSync from "@/components/TimezoneSync";
import { TimelineEntry } from "@/lib/timeline";
import { formatInZone, safeTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) return null; // middleware redirects unauthenticated users

  const [user, canvasAccount] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { timeZone: true } }),
    prisma.canvasAccount.findUnique({
      where: { userId: session.user.id },
      select: { domain: true, lastSyncedAt: true, lastSyncError: true },
    }),
  ]);
  const timeZone = safeTimeZone(user?.timeZone);

  const courseScope = { canvasAccount: { userId: session.user.id }, isActive: true };

  const [assignmentRows, syllabusRows] = await Promise.all([
    prisma.assignment.findMany({
      where: { course: courseScope, hasSubmitted: false },
      include: { course: { select: { id: true, name: true, courseCode: true } } },
    }),
    // Undated syllabus items are policies and facts — they belong on the
    // syllabus page, not in a list of things with deadlines.
    prisma.syllabusItem.findMany({
      where: { course: courseScope, date: { not: null } },
      include: { course: { select: { id: true, name: true, courseCode: true } } },
    }),
  ]);

  const entries: TimelineEntry[] = [
    ...assignmentRows.map((a) => ({
      id: `assignment:${a.id}`,
      source: "assignment" as const,
      name: a.name,
      url: a.htmlUrl,
      date: a.dueAt ? a.dueAt.toISOString() : null,
      isAllDay: a.isAllDay,
      assignmentId: a.id,
      pointsPossible: a.pointsPossible,
      syllabusKind: null,
      detail: null,
      priorityScore: a.priorityScore,
      priorityTier: a.priorityTier,
      course: a.course,
    })),
    ...syllabusRows.map((s) => ({
      id: `syllabus:${s.id}`,
      source: "syllabus" as const,
      name: s.title,
      url: null,
      date: s.date ? s.date.toISOString() : null,
      isAllDay: s.isAllDay,
      assignmentId: null,
      pointsPossible: null,
      syllabusKind: s.kind,
      detail: s.detail,
      priorityScore: s.priorityScore,
      priorityTier: s.priorityTier,
      course: s.course,
    })),
  ];

  return (
    <>
      <TimezoneSync storedTimeZone={user?.timeZone ?? "UTC"} />
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {!canvasAccount ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-10 text-center">
            <h1 className="text-xl font-bold">Connect Canvas to get started</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
              Canvity reads your courses and assignments from Canvas, ranks them by urgency and weight,
              and reminds you before things are due.
            </p>
            <Link
              href="/settings"
              className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Connect Canvas
            </Link>
          </div>
        ) : (
          <>
            {canvasAccount.lastSyncError && (
              <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Last sync had a problem: {canvasAccount.lastSyncError}
              </p>
            )}
            <Timeline entries={entries} timeZone={timeZone} />
            {canvasAccount.lastSyncedAt && (
              <p className="mt-8 text-xs text-[var(--muted)]">
                Last synced{" "}
                {formatInZone(canvasAccount.lastSyncedAt, timeZone, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
