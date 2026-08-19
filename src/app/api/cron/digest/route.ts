import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { sendDigestEmail } from "@/lib/email";

// Run hourly via Vercel Cron. Sends each user their digest once per day, at
// their configured local-ish hour (digestHour, stored in UTC), guarded by
// lastDigestSentAt so re-runs within the same day don't double-send.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const currentHour = now.getUTCHours();

  const users = await prisma.user.findMany({
    where: {
      digestEnabled: true,
      digestHour: currentHour,
      canvasAccount: { isNot: null },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (user.lastDigestSentAt && isSameUtcDay(user.lastDigestSentAt, now)) continue;

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
        priorityTier: a.priorityTier,
        priorityScore: a.priorityScore,
        fromSyllabus: false,
      })),
      ...syllabusItems.map((s) => ({
        name: s.title,
        courseName: s.course.name,
        dueAt: s.date,
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
      await sendDigestEmail(user.email, entries);
      await prisma.user.update({ where: { id: user.id }, data: { lastDigestSentAt: now } });
      sent++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ usersChecked: users.length, digestsSent: sent, failed });
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
