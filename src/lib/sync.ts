import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { CanvasApiError, CanvasClient } from "@/lib/canvas";
import { computePriority, computeSyllabusPriority } from "@/lib/priority";
import { syncFromFeed } from "@/lib/feed-sync";
import { effectiveInstant } from "@/lib/syllabus";
import { safeTimeZone } from "@/lib/timezone";

export interface SyncResult {
  coursesSynced: number;
  assignmentsSynced: number;
}

/** Pulls active courses + assignments from Canvas for one user and upserts them, recomputing priority. */
export async function syncUserCanvasData(userId: string): Promise<SyncResult> {
  const canvasAccount = await prisma.canvasAccount.findUnique({
    where: { userId },
    include: { courses: true },
  });

  if (!canvasAccount) {
    throw new Error("No Canvas account is connected for this user");
  }

  // Feed-connected accounts take an entirely different path: no API, no token.
  if (canvasAccount.connectionType === "feed") {
    const result = await syncFromFeed(userId);
    return { coursesSynced: result.coursesSynced, assignmentsSynced: result.assignmentsSynced };
  }

  if (!canvasAccount.encryptedToken) {
    throw new Error("This Canvas account has no API token saved");
  }
  const token = decryptToken(canvasAccount.encryptedToken);
  const client = new CanvasClient(canvasAccount.domain, token);

  let coursesSynced = 0;
  let assignmentsSynced = 0;

  try {
    const canvasCourses = await client.getActiveCourses();

    for (const canvasCourse of canvasCourses) {
      const course = await prisma.course.upsert({
        where: {
          canvasAccountId_canvasCourseId: {
            canvasAccountId: canvasAccount.id,
            canvasCourseId: String(canvasCourse.id),
          },
        },
        update: {
          name: canvasCourse.name,
          courseCode: canvasCourse.course_code,
          isActive: true,
        },
        create: {
          canvasAccountId: canvasAccount.id,
          canvasCourseId: String(canvasCourse.id),
          name: canvasCourse.name,
          courseCode: canvasCourse.course_code,
        },
      });
      coursesSynced++;

      const [groups, assignments] = await Promise.all([
        client.getAssignmentGroups(canvasCourse.id).catch(() => []),
        client.getAssignments(canvasCourse.id).catch(() => []),
      ]);

      const groupWeightById = new Map<number, number | null>();
      for (const g of groups) groupWeightById.set(g.id, g.group_weight);

      for (const a of assignments) {
        const dueAt = a.due_at ? new Date(a.due_at) : null;
        const groupWeight = groupWeightById.get(a.assignment_group_id) ?? null;
        const hasSubmitted =
          a.submission?.workflow_state === "submitted" ||
          a.submission?.workflow_state === "graded" ||
          !!a.submission?.submitted_at;

        const { score, tier } = computePriority({
          dueAt,
          pointsPossible: a.points_possible,
          groupWeight,
          hasSubmitted,
          courseWeight: course.weight,
        });

        await prisma.assignment.upsert({
          where: {
            courseId_canvasAssignmentId: {
              courseId: course.id,
              canvasAssignmentId: String(a.id),
            },
          },
          update: {
            name: a.name,
            description: a.description,
            htmlUrl: a.html_url,
            dueAt,
            pointsPossible: a.points_possible,
            groupWeight,
            submittedAt: a.submission?.submitted_at ? new Date(a.submission.submitted_at) : null,
            hasSubmitted,
            priorityScore: score,
            priorityTier: tier,
          },
          create: {
            courseId: course.id,
            canvasAssignmentId: String(a.id),
            name: a.name,
            description: a.description,
            htmlUrl: a.html_url,
            dueAt,
            pointsPossible: a.points_possible,
            groupWeight,
            submittedAt: a.submission?.submitted_at ? new Date(a.submission.submitted_at) : null,
            hasSubmitted,
            priorityScore: score,
            priorityTier: tier,
          },
        });
        assignmentsSynced++;
      }
    }

    await prisma.canvasAccount.update({
      where: { id: canvasAccount.id },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });
  } catch (err) {
    const message = err instanceof CanvasApiError ? err.message : "Sync failed unexpectedly";
    await prisma.canvasAccount.update({
      where: { id: canvasAccount.id },
      data: { lastSyncError: message },
    });
    throw err;
  }

  return { coursesSynced, assignmentsSynced };
}

/**
 * Re-scores every stored assignment and syllabus item against "now" without
 * hitting Canvas. Used by cron before sending notifications — a score computed
 * once at sync/scan time goes stale as the deadline approaches, so this is what
 * keeps "critical" actually meaning "imminent" days later.
 */
export async function recomputeAllPriorities(): Promise<void> {
  const assignments = await prisma.assignment.findMany({
    include: { course: true },
  });

  for (const a of assignments) {
    const { score, tier } = computePriority({
      dueAt: a.dueAt,
      pointsPossible: a.pointsPossible,
      groupWeight: a.groupWeight,
      hasSubmitted: a.hasSubmitted,
      courseWeight: a.course.weight,
    });
    if (score !== a.priorityScore || tier !== a.priorityTier) {
      await prisma.assignment.update({
        where: { id: a.id },
        data: { priorityScore: score, priorityTier: tier },
      });
    }
  }

  const syllabusItems = await prisma.syllabusItem.findMany({
    include: { course: { include: { canvasAccount: { include: { user: { select: { timeZone: true } } } } } } },
  });

  for (const item of syllabusItems) {
    const timeZone = safeTimeZone(item.course.canvasAccount.user.timeZone);
    const { score, tier } = computeSyllabusPriority({
      date: effectiveInstant(item.date, item.isAllDay, timeZone),
      importance: item.importance,
      courseWeight: item.course.weight,
    });
    if (score !== item.priorityScore || tier !== item.priorityTier) {
      await prisma.syllabusItem.update({
        where: { id: item.id },
        data: { priorityScore: score, priorityTier: tier },
      });
    }
  }
}
