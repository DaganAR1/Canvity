import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { sendDigestEmail } from "@/lib/email";
import { dayIndexInZone, safeTimeZone, zonedHour } from "@/lib/timezone";

// Run hourly via Vercel Cron. Sends each user their digest once per day, at
// their configured hour in their own timeZone, guarded by lastDigestSentAt so
// re-runs within the same local day don't double-send.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // digestHour can't be matched in SQL — it's a wall-clock hour in each user's
  // own zone, not a fixed UTC offset — so every enabled user is fetched and the
  // hour match is done in JS.
  const candidates = await prisma.user.findMany({
    where: { digestEnabled: true, canvasAccount: { isNot: null } },
  });
  const users = candidates.filter((u) => zonedHour(now, safeTimeZone(u.timeZone)) === u.digestHour);

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    const timeZone = safeTimeZone(user.timeZone);
    if (user.lastDigestSentAt && dayIndexInZone(user.lastDigestSentAt, timeZone) === dayIndexInZone(now, timeZone)) {
      continue;
    }

    const courseScope = { canvasAccount: { userId: user.id }, isActive: true };

    const [assignments, syllabusItems] = await Promise.all([
      prisma.assignment.findMany({
        where: { hasSubmitted: false, course: courseScope },
        include: { course: { select: { name: true } } },
        orderBy: [{ priorityScore: "desc" }, { dueAt: "asc" }],
        take: 10,
      }),
      prisma.syllabusItem.findMany({
        where: { date: { not: null }, course: courseScope },
        include: { course: { select: { name: true } } },
        orderBy: [{ priorityScore: "desc" }, { date: "asc" }],
        take: 10,
      }),
    ]);

    const entries = [
      ...assignments.map((a) => ({
        name: a.name,
        courseName: a.course.name,
        dueAt: a.dueAt,
        isAllDay: false,
        priorityTier: a.priorityTier,
        priorityScore: a.priorityScore,
        fromSyllabus: false,
      })),
      ...syllabusItems.map((s) => ({
        name: s.title,
        courseName: s.course.name,
        dueAt: s.date,
        isAllDay: s.isAllDay,
        priorityTier: s.priorityTier,
        priorityScore: s.priorityScore,
        fromSyllabus: true,
      })),
    ]
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 10);

    if (entries.length === 0) continue;

    // One user's delivery failure must not stop everyone else's digest.
    try {
      await sendDigestEmail(user.email, entries, timeZone);
      await prisma.user.update({ where: { id: user.id }, data: { lastDigestSentAt: now } });
      sent++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ usersChecked: users.length, digestsSent: sent, failed });
}
