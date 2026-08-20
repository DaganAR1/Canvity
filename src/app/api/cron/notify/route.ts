import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { recomputeAllPriorities } from "@/lib/sync";
import { effectiveInstant } from "@/lib/syllabus";
import { sendPushNotification } from "@/lib/push";
import { formatAllDay, formatInZone, safeTimeZone } from "@/lib/timezone";

interface Candidate {
  id: string;
  kind: "assignment" | "syllabus";
  title: string;
  courseName: string;
  /** The real instant to compare against notification windows (24h/72h cutoffs). */
  windowInstant: Date;
  /**
   * What to display: the true due instant for a timed item, or the original
   * calendar-date marker for an all-day one — never `windowInstant`, which for
   * an all-day item is an end-of-day instant that would read as the wrong date.
   */
  displayDate: Date;
  isAllDay: boolean;
  priorityTier: string;
  url: string | null;
  userId: string;
  timeZone: string;
  /** Syllabus items the syllabus itself frames as optional. */
  isOptional: boolean;
}

// An all-day syllabus item's stored `date` is a UTC-midnight calendar marker,
// not a real deadline instant, and its true effective-instant cutoff (end of
// that day in the owner's zone) can land up to ~14h either side of it. The SQL
// prefilter below is widened by this much so no all-day item near the edge of
// the window is missed or evaluated too early.
const ALL_DAY_SKEW_MS = 24 * 60 * 60 * 1000;

// Run frequently (e.g. every 30 min) via Vercel Cron. Sends push reminders for:
//  - anything due within the next 24h ("due_24h", fires once)
//  - critical-priority work due within 3 days ("due_72h_critical", fires once)
// Covers both Canvas assignments and dated items found in a course syllabus.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await recomputeAllPriorities();

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  const [assignments, syllabusItems] = await Promise.all([
    prisma.assignment.findMany({
      where: { hasSubmitted: false, dueAt: { gte: now, lte: in72h } },
      include: { course: { include: { canvasAccount: { include: { user: { select: { timeZone: true } } } } } } },
    }),
    prisma.syllabusItem.findMany({
      where: {
        date: { gte: new Date(now.getTime() - ALL_DAY_SKEW_MS), lte: new Date(in72h.getTime() + ALL_DAY_SKEW_MS) },
      },
      include: { course: { include: { canvasAccount: { include: { user: { select: { timeZone: true } } } } } } },
    }),
  ]);

  const candidates: Candidate[] = [
    ...assignments.map((a) => ({
      id: a.id,
      kind: "assignment" as const,
      title: a.name,
      courseName: a.course.name,
      windowInstant: a.dueAt!,
      displayDate: a.dueAt!,
      isAllDay: false,
      priorityTier: a.priorityTier,
      url: a.htmlUrl,
      userId: a.course.canvasAccount.userId,
      timeZone: safeTimeZone(a.course.canvasAccount.user.timeZone),
      isOptional: false,
    })),
    ...syllabusItems
      .map((s) => {
        const timeZone = safeTimeZone(s.course.canvasAccount.user.timeZone);
        return {
          id: s.id,
          kind: "syllabus" as const,
          title: s.title,
          courseName: s.course.name,
          // The true deadline instant, not the stored calendar-date marker —
          // this is what the notification window is actually measured against.
          windowInstant: effectiveInstant(s.date, s.isAllDay, timeZone)!,
          displayDate: s.date!,
          isAllDay: s.isAllDay,
          priorityTier: s.priorityTier,
          url: null,
          userId: s.course.canvasAccount.userId,
          timeZone,
          isOptional: s.importance === "low",
        };
      })
      // Re-apply the real window now that dates are true instants — the SQL
      // prefilter above was deliberately loose.
      .filter((c) => c.windowInstant >= now && c.windowInstant <= in72h),
  ];

  // One lookup of each user's devices, rather than one per candidate.
  const subsByUser = new Map<string, { id: string; endpoint: string; p256dh: string; auth: string }[]>();
  for (const userId of new Set(candidates.map((c) => c.userId))) {
    subsByUser.set(userId, await prisma.pushSubscription.findMany({ where: { userId } }));
  }

  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    // An optional reading does not deserve an interrupt, however soon it is.
    // It still shows on the timeline and in the daily digest.
    if (candidate.isOptional) continue;

    const dueSoon = candidate.windowInstant <= in24h;
    if (!dueSoon && candidate.priorityTier !== "critical") continue;

    const notificationKind = dueSoon ? "due_24h" : "due_72h_critical";
    const subscriptions = subsByUser.get(candidate.userId) ?? [];
    if (subscriptions.length === 0) continue;

    const alreadySent = await prisma.notificationLog.findFirst({
      where: {
        userId: candidate.userId,
        channel: "push",
        kind: notificationKind,
        ...(candidate.kind === "assignment"
          ? { assignmentId: candidate.id }
          : { syllabusItemId: candidate.id }),
      },
    });
    if (alreadySent) continue;

    // An all-day item has no real clock time, so it gets a plain date instead
    // of a fabricated one — the underlying instant is midnight in some zone,
    // which is meaningless to show as "due at".
    const dueLabel = candidate.isAllDay
      ? formatAllDay(candidate.displayDate, { weekday: "short", month: "short", day: "numeric" })
      : formatInZone(candidate.displayDate, candidate.timeZone, { weekday: "short", hour: "numeric", minute: "2-digit" });
    const prefix = candidate.kind === "syllabus" ? "From your syllabus" : candidate.courseName;

    // A failing endpoint for one device must not stop the rest of the run.
    let delivered = false;
    for (const sub of subscriptions) {
      try {
        const ok = await sendPushNotification(sub, {
          title: dueSoon ? `Due soon: ${candidate.title}` : `High priority: ${candidate.title}`,
          body: `${prefix} · due ${dueLabel}`,
          url: candidate.url ?? "/",
        });
        if (ok) {
          delivered = true;
        } else {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      } catch {
        failed++;
      }
    }

    // Only log it as sent when it actually reached a device, so a transient
    // outage doesn't permanently suppress the reminder.
    if (delivered) {
      await prisma.notificationLog.create({
        data: {
          userId: candidate.userId,
          channel: "push",
          kind: notificationKind,
          ...(candidate.kind === "assignment"
            ? { assignmentId: candidate.id }
            : { syllabusItemId: candidate.id }),
        },
      });
      sent++;
    }
  }

  return NextResponse.json({ checked: candidates.length, notificationsSent: sent, failed });
}
