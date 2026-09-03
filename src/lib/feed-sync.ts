import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { computePriority } from "@/lib/priority";
import { parseIcs, IcsEvent } from "@/lib/ics";

export interface FeedSyncResult {
  coursesSynced: number;
  assignmentsSynced: number;
  eventsSkipped: number;
}

export class FeedSyncError extends Error {}

/** Feeds are usually small; this is a guard against a pathological response. */
const MAX_FEED_BYTES = 5_000_000;

/**
 * Pulls coursework from a student's Canvas calendar feed.
 *
 * This is the access path that works without an API token or administrator
 * involvement. It carries less than the REST API — no point values, no
 * assignment-group weights, no submission status — so priority scoring here
 * leans on urgency plus whatever course weight the student sets by hand, and
 * completion has to be marked manually rather than detected.
 */
export async function syncFromFeed(userId: string): Promise<FeedSyncResult> {
  const account = await prisma.canvasAccount.findUnique({ where: { userId } });
  if (!account) throw new FeedSyncError("No Canvas account is connected for this user");
  if (!account.encryptedFeedUrl) throw new FeedSyncError("This account has no calendar feed URL saved");

  const feedUrl = decryptToken(account.encryptedFeedUrl);

  let raw: string;
  try {
    const res = await fetch(feedUrl, { cache: "no-store", redirect: "follow" });
    if (!res.ok) {
      throw new FeedSyncError(
        res.status === 404
          ? "Canvas returned 404 for that feed URL. It may have been reset — copy a fresh one from Canvas → Calendar → Calendar Feed."
          : `Canvas returned ${res.status} for the calendar feed.`
      );
    }
    raw = await res.text();
    if (raw.length > MAX_FEED_BYTES) {
      throw new FeedSyncError("That calendar feed is unexpectedly large; refusing to process it.");
    }
  } catch (err) {
    const message = err instanceof FeedSyncError ? err.message : "Could not download the calendar feed.";
    await prisma.canvasAccount.update({ where: { id: account.id }, data: { lastSyncError: message } });
    throw err instanceof FeedSyncError ? err : new FeedSyncError(message);
  }

  const events = parseIcs(raw);
  if (events.length === 0 && !raw.includes("BEGIN:VCALENDAR")) {
    const message = "That URL didn't return a calendar. Double-check you copied the Calendar Feed link.";
    await prisma.canvasAccount.update({ where: { id: account.id }, data: { lastSyncError: message } });
    throw new FeedSyncError(message);
  }

  // Only dated assignments become coursework. Plain calendar events carry no
  // deadline consequence, and undated ones can't be placed on a timeline.
  const usable = events.filter((e) => e.isAssignment && e.date !== null);
  const eventsSkipped = events.length - usable.length;

  const byCourse = new Map<string, IcsEvent[]>();
  for (const event of usable) {
    // Prefer the real Canvas course id from the event URL; fall back to the
    // course code so a feed without links still groups sensibly.
    const key = event.canvasCourseId ?? (event.courseCode ? `code:${event.courseCode}` : "unknown");
    const list = byCourse.get(key) ?? [];
    list.push(event);
    byCourse.set(key, list);
  }

  let coursesSynced = 0;
  let assignmentsSynced = 0;

  for (const [courseKey, courseEvents] of byCourse) {
    const courseCode = courseEvents.find((e) => e.courseCode)?.courseCode ?? null;

    const course = await prisma.course.upsert({
      where: {
        canvasAccountId_canvasCourseId: { canvasAccountId: account.id, canvasCourseId: courseKey },
      },
      // The feed gives a course code but never a full course name, so the code
      // is the best label available. Don't overwrite a name a token-based sync
      // may have set previously.
      update: { courseCode: courseCode ?? undefined, isActive: true },
      create: {
        canvasAccountId: account.id,
        canvasCourseId: courseKey,
        name: courseCode ?? "Course",
        courseCode,
      },
    });
    coursesSynced++;

    for (const event of courseEvents) {
      const canvasAssignmentId = event.canvasAssignmentId ?? event.uid;
      const { score, tier } = computePriority({
        dueAt: event.date,
        pointsPossible: null, // the feed never carries point values
        groupWeight: null,
        hasSubmitted: false,
        courseWeight: course.weight,
      });

      await prisma.assignment.upsert({
        where: {
          courseId_canvasAssignmentId: { courseId: course.id, canvasAssignmentId },
        },
        // hasSubmitted is deliberately absent from the update: with no
        // submission data in the feed, the student marks work done by hand,
        // and a re-sync must not undo that.
        update: {
          name: event.title,
          htmlUrl: event.url,
          dueAt: event.date,
          isAllDay: event.isAllDay,
          priorityScore: score,
          priorityTier: tier,
        },
        create: {
          courseId: course.id,
          canvasAssignmentId,
          name: event.title,
          description: event.description,
          htmlUrl: event.url,
          dueAt: event.date,
          isAllDay: event.isAllDay,
          pointsPossible: null,
          groupWeight: null,
          hasSubmitted: false,
          priorityScore: score,
          priorityTier: tier,
        },
      });
      assignmentsSynced++;
    }
  }

  await prisma.canvasAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });

  return { coursesSynced, assignmentsSynced, eventsSkipped };
}
