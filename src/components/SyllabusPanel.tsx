"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SyllabusCourse {
  id: string;
  name: string;
  courseCode: string | null;
  syllabusSource: string | null;
  syllabusScannedAt: string | null;
  syllabusError: string | null;
  items: {
    id: string;
    kind: string;
    title: string;
    detail: string | null;
    date: string | null;
    importance: string;
    sourceQuote: string | null;
  }[];
}

const IMPORTANCE_STYLES: Record<string, string> = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-blue-600 dark:text-blue-400",
  low: "text-slate-500",
};

export default function SyllabusPanel({ course }: { course: SyllabusCourse }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan(force: boolean) {
    setScanning(true);
    setStatus(null);
    setError(null);

    const res = await fetch(`/api/courses/${course.id}/syllabus${force ? "?force=true" : ""}`, {
      method: "POST",
    });
    setScanning(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Scan failed");
      return;
    }

    const data = await res.json();
    if (data.status === "not_found") {
      setStatus("No syllabus found in this Canvas course.");
    } else if (data.status === "unchanged") {
      setStatus("Syllabus hasn't changed since the last scan.");
    } else {
      setStatus(`Found ${data.itemsFound} items (${data.datedItems} with dates) in ${data.source}.`);
    }
    router.refresh();
  }

  const dated = course.items.filter((i) => i.date);
  const undated = course.items.filter((i) => !i.date);
  const scanned = course.syllabusScannedAt !== null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold">{course.name}</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {course.syllabusSource
              ? `From ${course.syllabusSource}`
              : scanned
                ? "No syllabus found"
                : "Not scanned yet"}
            {course.syllabusScannedAt && ` · ${new Date(course.syllabusScannedAt).toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {scanned && (
            <button
              onClick={() => scan(true)}
              disabled={scanning}
              className="text-xs text-[var(--muted)] hover:text-blue-600 disabled:opacity-50"
            >
              Rescan
            </button>
          )}
          <button
            onClick={() => scan(false)}
            disabled={scanning}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {scanning ? "Scanning…" : scanned ? "Check for updates" : "Scan syllabus"}
          </button>
        </div>
      </div>

      {status && <p className="mt-3 text-sm text-green-600">{status}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {course.syllabusError && !error && (
        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{course.syllabusError}</p>
      )}

      {dated.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Dates found ({dated.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {dated.map((item) => (
              <li key={item.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{item.title}</span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">{formatDate(item.date!)}</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  <span className={`capitalize ${IMPORTANCE_STYLES[item.importance] ?? ""}`}>{item.kind}</span>
                  {item.detail && ` · ${item.detail}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {undated.length > 0 && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Policies &amp; key facts ({undated.length})
          </h3>
          <ul className="mt-2 space-y-2.5">
            {undated.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="font-medium">{item.title}</span>
                {item.detail && <p className="text-xs leading-relaxed text-[var(--muted)]">{item.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
