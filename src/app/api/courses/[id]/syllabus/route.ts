import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scanCourseSyllabus } from "@/lib/syllabus";

export const maxDuration = 300; // extraction on a long syllabus can take a while

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const course = await prisma.course.findFirst({
    where: { id, canvasAccount: { userId: session.user.id } },
    select: { id: true },
  });
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

  const force = new URL(req.url).searchParams.get("force") === "true";

  try {
    const result = await scanCourseSyllabus(course.id, { force });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Syllabus scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const course = await prisma.course.findFirst({
    where: { id, canvasAccount: { userId: session.user.id } },
    select: {
      id: true,
      name: true,
      syllabusSource: true,
      syllabusScannedAt: true,
      syllabusError: true,
      syllabusItems: { orderBy: [{ date: "asc" }, { importance: "asc" }] },
    },
  });
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

  return NextResponse.json({ course });
}
