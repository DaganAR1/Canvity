"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Saves the browser's timezone the first time a signed-in user loads the app.
 *
 * `timeZone` defaults to UTC, and until it's corrected every date the app shows
 * is computed in UTC — which for anyone west of Greenwich means the app rolls
 * over to "tomorrow" partway through their evening, and starts calling
 * tomorrow's work due today. Leaving that to a setting the user has to find is
 * how it went unnoticed; detecting it on load is the fix.
 *
 * Only fires while the stored value is still the UTC default, so it never
 * overrides a zone the user picked deliberately — including an actual UTC one,
 * since browsers in that band report a named zone like Europe/London rather
 * than the literal string "UTC".
 */
export default function TimezoneSync({ storedTimeZone }: { storedTimeZone: string }) {
  const router = useRouter();

  useEffect(() => {
    if (storedTimeZone !== "UTC") return;

    let detected: string | undefined;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!detected || detected === "UTC") return;

    let cancelled = false;
    (async () => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeZone: detected }),
      });
      // Dates are rendered on the server from the stored zone, so the page has
      // to re-render before it shows the right day.
      if (res.ok && !cancelled) router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [storedTimeZone, router]);

  return null;
}
