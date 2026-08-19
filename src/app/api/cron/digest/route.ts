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

    const assignments = await prisma.assignment.findMany({
      where: {
        hasSubmitted: false,
        course: { canvasAccount: { userId: user.id }, isActive: true },
      },
      include: { course: { select: { name: true } } },
      orderBy: [{ priorityScore: "desc" }, { dueAt: "asc" }],
      take: 10,
    });

    if (assignments.length === 0) continue;

    // One user's delivery failure must not stop everyone else's digest.
    try {
      await sendDigestEmail(
        user.email,
        assignments.map((a) => ({
          name: a.name,
          courseName: a.course.name,
          dueAt: a.dueAt,
          priorityTier: a.priorityTier,
          url: a.htmlUrl,
        }))
      );
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
