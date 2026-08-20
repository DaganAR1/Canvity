import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import SyllabusPanel from "@/components/SyllabusPanel";
import { safeTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function SyllabusPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [user, courses] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { timeZone: true } }),
    prisma.course.findMany({
      where: { canvasAccount: { userId: session.user.id }, isActive: true },
      include: { syllabusItems: { orderBy: [{ date: "asc" }, { title: "asc" }] } },
      orderBy: { name: "asc" },
    }),
  ]);
  const timeZone = safeTimeZone(user?.timeZone);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-bold">Syllabus scan</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Reads each course syllabus for exam dates, milestones, and policies. Anything with a date
          joins your timeline — those are the deadlines that never become Canvas assignments.
        </p>

        {courses.length === 0 ? (
          <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-10 text-center">
            <p className="font-medium">No courses yet.</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              <Link href="/settings" className="text-blue-600 hover:underline">
                Connect Canvas
              </Link>{" "}
              and sync first.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {courses.map((course) => (
              <SyllabusPanel
                key={course.id}
                timeZone={timeZone}
                course={{
                  id: course.id,
                  name: course.name,
                  courseCode: course.courseCode,
                  syllabusSource: course.syllabusSource,
                  syllabusScannedAt: course.syllabusScannedAt?.toISOString() ?? null,
                  syllabusError: course.syllabusError,
                  items: course.syllabusItems.map((i) => ({
                    id: i.id,
                    kind: i.kind,
                    title: i.title,
                    detail: i.detail,
                    date: i.date?.toISOString() ?? null,
                    isAllDay: i.isAllDay,
                    importance: i.importance,
                    sourceQuote: i.sourceQuote,
                  })),
                }}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
