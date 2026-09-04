import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { computePriority } from "@/lib/priority";

const updateSchema = z.object({
  hasSubmitted: z.boolean(),
});

/**
 * Marks an assignment done, or undoes that.
 *
 * A calendar-feed connection carries no submission status, so without this
 * every finished assignment in the term stays on the timeline as overdue
 * forever. Token connections get this from Canvas automatically, but the
 * manual toggle is still useful for work submitted on paper or in person.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const assignment = await prisma.assignment.findFirst({
    where: { id, course: { canvasAccount: { userId: session.user.id } } },
    include: { course: { select: { weight: true } } },
  });
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { hasSubmitted } = parsed.data;
  const { score, tier } = computePriority({
    dueAt: assignment.dueAt,
    pointsPossible: assignment.pointsPossible,
    groupWeight: assignment.groupWeight,
    hasSubmitted,
    courseWeight: assignment.course.weight,
  });

  const updated = await prisma.assignment.update({
    where: { id },
    data: {
      hasSubmitted,
      submittedAt: hasSubmitted ? (assignment.submittedAt ?? new Date()) : null,
      priorityScore: score,
      priorityTier: tier,
    },
    select: { id: true, hasSubmitted: true, priorityTier: true },
  });

  return NextResponse.json({ assignment: updated });
}
