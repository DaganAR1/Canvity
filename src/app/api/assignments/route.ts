import { NextResponse } from "next/server";
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
