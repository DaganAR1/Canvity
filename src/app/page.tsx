import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import Timeline from "@/components/Timeline";
import { TimelineAssignment } from "@/lib/timeline";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) return null; // middleware redirects unauthenticated users

  const canvasAccount = await prisma.canvasAccount.findUnique({
    where: { userId: session.user.id },
    select: { domain: true, lastSyncedAt: true, lastSyncError: true },
  });

  const rows = await prisma.assignment.findMany({
    where: { course: { canvasAccount: { userId: session.user.id }, isActive: true } },
    include: { course: { select: { id: true, name: true, courseCode: true } } },
    orderBy: [{ priorityScore: "desc" }, { dueAt: "asc" }],
  });

  const assignments: TimelineAssignment[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    htmlUrl: a.htmlUrl,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    pointsPossible: a.pointsPossible,
    hasSubmitted: a.hasSubmitted,
    priorityScore: a.priorityScore,
    priorityTier: a.priorityTier,
    course: a.course,
  }));

  return (
    <>
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
            <Timeline assignments={assignments} />
            {canvasAccount.lastSyncedAt && (
              <p className="mt-8 text-xs text-[var(--muted)]">
                Last synced {canvasAccount.lastSyncedAt.toLocaleString()}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
