"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Course {
  id: string;
  name: string;
  courseCode: string | null;
  weight: number;
}

const WEIGHT_LABELS: { value: number; label: string }[] = [
  { value: 0.5, label: "Low" },
  { value: 0.75, label: "Below normal" },
  { value: 1, label: "Normal" },
  { value: 1.5, label: "Above normal" },
  { value: 2, label: "High" },
];

export default function CourseWeights({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);

  async function updateWeight(id: string, weight: number) {
    setSaving(id);
    await fetch(`/api/courses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weight }),
    });
    setSaving(null);
    router.refresh();
  }

  if (courses.length === 0) return null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
      <h2 className="text-lg font-semibold">Course importance</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Nudge how heavily each course counts toward priority. Canvas point values and group weights still do most of the work.
      </p>

      <ul className="mt-5 space-y-3">
        {courses.map((course) => (
          <li key={course.id} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{course.name}</p>
              {course.courseCode && <p className="truncate text-xs text-[var(--muted)]">{course.courseCode}</p>}
            </div>
            <select
              value={course.weight}
              disabled={saving === course.id}
              onChange={(e) => updateWeight(course.id, Number(e.target.value))}
              className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm disabled:opacity-50"
            >
              {WEIGHT_LABELS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
