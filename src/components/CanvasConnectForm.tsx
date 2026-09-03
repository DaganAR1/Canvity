"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  connected: { domain: string; connectionType: string; lastSyncedAt: string | null } | null;
}

type Mode = "feed" | "token";

export default function CanvasConnectForm({ connected }: Props) {
  const router = useRouter();
  // Default new users to the feed, since it's the only route that works
  // regardless of what the institution allows.
  const [mode, setMode] = useState<Mode>((connected?.connectionType as Mode) ?? "feed");
  const [domain, setDomain] = useState(connected?.domain ?? "");
  const [token, setToken] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [status, setStatus] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);

    const body =
      mode === "feed"
        ? { connectionType: "feed", feedUrl }
        : { connectionType: "token", domain, token };

    const res = await fetch("/api/canvas-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus({ type: "error", message: data.error ?? "Could not connect" });
      setSaving(false);
      return;
    }

    const syncRes = await fetch("/api/sync", { method: "POST" });
    setSaving(false);
    setToken("");
    setFeedUrl("");

    if (!syncRes.ok) {
      const data = await syncRes.json().catch(() => ({}));
      setStatus({ type: "error", message: `Connected, but the first sync failed: ${data.error ?? "unknown error"}` });
    } else {
      const data = await syncRes.json();
      setStatus({
        type: "success",
        message: `Connected. Pulled ${data.assignmentsSynced} assignments across ${data.coursesSynced} courses.`,
      });
    }
    router.refresh();
  }

  async function handleDisconnect() {
    setSaving(true);
    await fetch("/api/canvas-account", { method: "DELETE" });
    setSaving(false);
    setDomain("");
    setToken("");
    setFeedUrl("");
    setStatus(null);
    router.refresh();
  }

  const tabClass = (m: Mode) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      mode === m
        ? "bg-blue-600 text-white"
        : "border border-[var(--border)] text-[var(--muted)] hover:bg-slate-50 dark:hover:bg-slate-800"
    }`;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
      <h2 className="text-lg font-semibold">Canvas connection</h2>

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => setMode("feed")} className={tabClass("feed")}>
          Calendar feed
        </button>
        <button type="button" onClick={() => setMode("token")} className={tabClass("token")}>
          Access token
        </button>
      </div>

      {mode === "feed" ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          In Canvas go to <span className="font-medium">Calendar</span>, click{" "}
          <span className="font-medium">Calendar Feed</span> at the bottom of the right sidebar, and copy the link.
          Works at every school — no token and no administrator approval needed. Treat the link like a password;
          it&apos;s encrypted before being stored.
        </p>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">
          Create a token under <span className="font-medium">Account → Settings → New Access Token</span>. Richer than
          the feed — adds point values, group weights and automatic completion — but many schools disable this.
          It&apos;s encrypted before being stored.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {mode === "feed" ? (
          <div>
            <label htmlFor="feedUrl" className="block text-sm font-medium mb-1.5">
              Calendar feed URL
            </label>
            <input
              id="feedUrl"
              required
              placeholder="https://myschool.instructure.com/feeds/calendars/user_....ics"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="domain" className="block text-sm font-medium mb-1.5">
                Canvas domain
              </label>
              <input
                id="domain"
                required
                placeholder="myschool.instructure.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="token" className="block text-sm font-medium mb-1.5">
                Access token
              </label>
              <input
                id="token"
                type="password"
                required
                placeholder="Paste your Canvas token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {status && (
          <p className={`text-sm ${status.type === "error" ? "text-red-600" : "text-green-600"}`}>{status.message}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || (mode === "feed" ? !feedUrl : !domain || !token)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Working…" : connected ? "Update & sync" : "Connect & sync"}
          </button>
          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={saving}
              className="text-sm text-[var(--muted)] hover:text-red-600"
            >
              Disconnect
            </button>
          )}
        </div>
      </form>

      {connected && (
        <p className="mt-4 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
          Connected to <span className="font-medium">{connected.domain}</span> via{" "}
          {connected.connectionType === "feed" ? "calendar feed" : "access token"}.
          {connected.connectionType === "feed" &&
            " Point values and submission status aren't available over the feed, so mark work done yourself and set course importance in Settings."}
        </p>
      )}
    </section>
  );
}
