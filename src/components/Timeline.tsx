"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildTimeline, TimelineAssignment } from "@/lib/timeline";

const TIER_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  critical: { dot: "bg-red-500", label: "Critical", text: "text-red-600" },
  high: { dot: "bg-orange-500", label: "High", text: "text-orange-600" },
  normal: { dot: "bg-blue-500", label: "Normal", text: "text-blue-600" },
  low: { dot: "bg-slate-400", label: "Low", text: "text-slate-500" },
  done: { dot: "bg-green-500", label: "Done", text: "text-green-600" },
};

export default function Timeline({ assignments }: { assignments: TimelineAssignment[] }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const buckets = useMemo(() => buildTimeline(assignments), [assignments]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    const res = await fetch("/api/sync", { method: "POST" });
    setSyncing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSyncError(data.error ?? "Sync failed");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your timeline</h1>
          <p className="text-sm text-[var(--muted)]">Sorted by what needs attention first, not just what&apos;s next.</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3.5 py-2 text-sm font-medium hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-slate-800"
        >
          {syncing ? "Syncing…" : "Sync Canvas"}
        </button>
      </div>

      {syncError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950">
          {syncError}
        </p>
      )}

      {buckets.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-10 text-center">
          <p className="font-medium">Nothing on the timeline yet.</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Connect Canvas in Settings, then hit Sync to pull your assignments.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {buckets.map((bucket) => (
            <section key={bucket.key}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                {bucket.label}
                <span className="rounded-full bg-[var(--card)] px-2 py-0.5 text-xs font-medium normal-case border border-[var(--border)]">
                  {bucket.assignments.length}
                </span>
              </h2>
              <ul className="space-y-2">
                {bucket.assignments.map((a) => {
                  const tier = TIER_STYLES[a.priorityTier] ?? TIER_STYLES.normal;
                  return (
                    <li
                      key={a.id}
                      className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
                    >
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tier.dot}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          {a.htmlUrl ? (
                            <a
                              href={a.htmlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate font-medium hover:text-blue-600 hover:underline"
                            >
                              {a.name}
                            </a>
                          ) : (
                            <span className="truncate font-medium">{a.name}</span>
                          )}
                          <span className={`shrink-0 text-xs font-semibold ${tier.text}`}>{tier.label}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                          <span>{a.course.courseCode || a.course.name}</span>
                          <span aria-hidden>·</span>
                          <span>{formatDue(a.dueAt)}</span>
                          {a.pointsPossible !== null && (
                            <>
                              <span aria-hidden>·</span>
                              <span>{a.pointsPossible} pts</span>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDue(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  const date = new Date(dueAt);
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
