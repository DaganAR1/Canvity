"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-syncs Canvas in the background when the app is opened with stale data.
 *
 * The scheduled job can only run once a day on Vercel's free plan, which
 * leaves a long window where something posted in Canvas isn't here yet. But
 * fresh data only actually matters while someone is looking at it — so
 * refreshing on load covers the real need without depending on cron frequency
 * at all.
 *
 * Deliberately silent: this runs without being asked, so a failure shouldn't
 * throw an error banner at someone who didn't press anything. The manual Sync
 * button still surfaces errors properly.
 */
export default function AutoSync({
  lastSyncedAt,
  staleAfterMinutes = 30,
}: {
  lastSyncedAt: string | null;
  staleAfterMinutes?: number;
}) {
  const router = useRouter();
  // Effects run twice in development; without this the sync fires twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;

    const stale =
      lastSyncedAt === null ||
      Date.now() - new Date(lastSyncedAt).getTime() > staleAfterMinutes * 60_000;
    if (!stale) return;

    started.current = true;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/sync", { method: "POST" });
        // Only re-render when something might actually have changed.
        if (res.ok && !cancelled) router.refresh();
      } catch {
        // A background refresh that fails is not worth interrupting anyone over.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lastSyncedAt, staleAfterMinutes, router]);

  return null;
}
