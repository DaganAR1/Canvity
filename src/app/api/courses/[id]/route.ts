import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { computePriority } from "@/lib/priority";

const updateSchema = z.object({
  weight: z.number().min(0.5).max(2).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const course = await prisma.course.findFirst({
    where: { id, canvasAccount: { userId: session.user.id } },
    include: { assignments: true },
  });
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.course.update({ where: { id }, data: parsed.data });

  if (parsed.data.weight !== undefined) {
    for (const a of course.assignments) {
      const { score, tier } = computePriority({
        dueAt: a.dueAt,
        pointsPossible: a.pointsPossible,
        groupWeight: a.groupWeight,
        hasSubmitted: a.hasSubmitted,
        courseWeight: updated.weight,
      });
      await prisma.assignment.update({
        where: { id: a.id },
        data: { priorityScore: score, priorityTier: tier },
      });
    }
  }

  return NextResponse.json({ course: updated });
}
