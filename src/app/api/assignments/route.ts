import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assignments = await prisma.assignment.findMany({
    where: {
      course: {
        canvasAccount: { userId: session.user.id },
        isActive: true,
      },
    },
    include: { course: { select: { id: true, name: true, courseCode: true, weight: true } } },
    orderBy: [{ priorityScore: "desc" }, { dueAt: "asc" }],
  });

  return NextResponse.json({ assignments });
}

const bulkSchema = z.object({
  action: z.literal("complete_overdue"),
});

/**
 * Marks everything already past due as done, in one action.
 *
 * Connecting a calendar feed imports the whole term at once, and since the
 * feed carries no submission status, every assignment the student already
 * finished lands on the timeline as overdue. Clearing that backlog one
 * checkbox at a time is not a reasonable first-run experience.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const now = new Date();
  const { count } = await prisma.assignment.updateMany({
    where: {
      course: { canvasAccount: { userId: session.user.id } },
      hasSubmitted: false,
      dueAt: { lt: now },
    },
    data: { hasSubmitted: true, submittedAt: now, priorityScore: 0, priorityTier: "done" },
  });

  return NextResponse.json({ completed: count });
}
