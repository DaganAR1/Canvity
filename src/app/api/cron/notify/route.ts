import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { recomputeAllPriorities } from "@/lib/sync";
import { sendPushNotification } from "@/lib/push";

// Run frequently (e.g. every 30 min) via Vercel Cron. Sends push reminders for:
//  - anything due within the next 24h ("due_24h", fires once)
//  - critical-priority assignments due within 3 days ("due_72h_critical", fires once)
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await recomputeAllPriorities();

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  const candidates = await prisma.assignment.findMany({
    where: {
      hasSubmitted: false,
      dueAt: { gte: now, lte: in72h },
    },
    include: {
      course: { include: { canvasAccount: { include: { user: { include: { pushSubscriptions: true } } } } } },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const a of candidates) {
    const dueSoon = a.dueAt !== null && a.dueAt <= in24h;
    const criticalSoon = a.priorityTier === "critical";
    if (!dueSoon && !criticalSoon) continue;

    const kind = dueSoon ? "due_24h" : "due_72h_critical";
    const user = a.course.canvasAccount.user;

    const alreadySent = await prisma.notificationLog.findUnique({
      where: { userId_assignmentId_channel_kind: { userId: user.id, assignmentId: a.id, channel: "push", kind } },
    });
    if (alreadySent) continue;
    if (user.pushSubscriptions.length === 0) continue;

    const dueLabel = a.dueAt
      ? a.dueAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })
      : "soon";

    // A failing endpoint for one device must not stop the rest of the run.
    let delivered = false;
    for (const sub of user.pushSubscriptions) {
      try {
        const ok = await sendPushNotification(sub, {
          title: dueSoon ? `Due soon: ${a.name}` : `High priority: ${a.name}`,
          body: `${a.course.name} · due ${dueLabel}`,
          url: a.htmlUrl ?? "/",
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
        data: { userId: user.id, assignmentId: a.id, channel: "push", kind },
      });
      sent++;
    }
  }

  return NextResponse.json({ checked: candidates.length, notificationsSent: sent, failed });
}
