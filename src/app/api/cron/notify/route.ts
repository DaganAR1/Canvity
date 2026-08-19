import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { recomputeAllPriorities } from "@/lib/sync";
import { sendPushNotification } from "@/lib/push";

interface Candidate {
  id: string;
  kind: "assignment" | "syllabus";
  title: string;
  courseName: string;
  date: Date;
  priorityTier: string;
  url: string | null;
  userId: string;
  /** Syllabus items the syllabus itself frames as optional. */
  isOptional: boolean;
}

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
      include: { course: { include: { canvasAccount: true } } },
    }),
    prisma.syllabusItem.findMany({
      where: { date: { gte: now, lte: in72h } },
      include: { course: { include: { canvasAccount: true } } },
    }),
  ]);

  const candidates: Candidate[] = [
    ...assignments.map((a) => ({
      id: a.id,
      kind: "assignment" as const,
      title: a.name,
      courseName: a.course.name,
      date: a.dueAt!,
      priorityTier: a.priorityTier,
      url: a.htmlUrl,
      userId: a.course.canvasAccount.userId,
      isOptional: false,
    })),
    ...syllabusItems.map((s) => ({
      id: s.id,
      kind: "syllabus" as const,
      title: s.title,
      courseName: s.course.name,
      date: s.date!,
      priorityTier: s.priorityTier,
      url: null,
      userId: s.course.canvasAccount.userId,
      isOptional: s.importance === "low",
    })),
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

    const dueSoon = candidate.date <= in24h;
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

    const dueLabel = candidate.date.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
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
