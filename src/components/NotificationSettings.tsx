"use client";

import { useEffect, useState } from "react";

interface Props {
  digestEnabled: boolean;
  digestHour: number;
  email: string;
}

export default function NotificationSettings({ digestEnabled, digestHour, email }: Props) {
  const [enabled, setEnabled] = useState(digestEnabled);
  const [hour, setHour] = useState(digestHour);
  const [pushState, setPushState] = useState<"unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading">("loading");
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setPushState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setPushState(sub ? "subscribed" : "unsubscribed");
    }
    check();
  }, []);

  async function saveDigest(next: { digestEnabled?: boolean; digestHour?: number }) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  }

  async function enablePush() {
    setPushError(null);
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setPushError("Push isn't configured on the server (missing NEXT_PUBLIC_VAPID_PUBLIC_KEY).");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushState("denied");
      return;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });

    if (!res.ok) {
      setPushError("Could not save the subscription. Try again.");
      return;
    }
    setPushState("subscribed");
  }

  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setPushState("unsubscribed");
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
      <h2 className="text-lg font-semibold">Notifications</h2>

      <div className="mt-5 space-y-5">
        <div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Browser push</p>
              <p className="text-xs text-[var(--muted)]">
                Reminders 24 hours before anything is due, plus early warnings on critical work.
              </p>
            </div>
            {pushState === "subscribed" ? (
              <button onClick={disablePush} className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                Turn off
              </button>
            ) : pushState === "unsubscribed" ? (
              <button onClick={enablePush} className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                Enable
              </button>
            ) : (
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {pushState === "denied" ? "Blocked in browser settings" : pushState === "unsupported" ? "Not supported here" : "Checking…"}
              </span>
            )}
          </div>
          {pushError && <p className="mt-2 text-sm text-red-600">{pushError}</p>}
        </div>

        <div className="border-t border-[var(--border)] pt-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Daily email digest</p>
              <p className="text-xs text-[var(--muted)]">Your top 10 priorities, sent to {email}.</p>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                saveDigest({ digestEnabled: e.target.checked });
              }}
              className="h-4 w-4 shrink-0 accent-blue-600"
            />
          </div>

          {enabled && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-[var(--muted)]">Send at</span>
              <select
                value={hour}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setHour(next);
                  saveDigest({ digestHour: next });
                }}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00 UTC
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </section>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
