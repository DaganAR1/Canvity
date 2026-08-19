"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  connected: { domain: string; lastSyncedAt: string | null } | null;
}

export default function CanvasConnectForm({ connected }: Props) {
  const router = useRouter();
  const [domain, setDomain] = useState(connected?.domain ?? "");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);

    const res = await fetch("/api/canvas-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, token }),
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
    setStatus(null);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
      <h2 className="text-lg font-semibold">Canvas connection</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Create a personal access token in Canvas under <span className="font-medium">Account → Settings → New Access Token</span>.
        It&apos;s encrypted before being stored.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="domain" className="block text-sm font-medium mb-1.5">Canvas domain</label>
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
            Access token {connected && <span className="font-normal text-[var(--muted)]">(leave blank to keep the current one)</span>}
          </label>
          <input
            id="token"
            type="password"
            required={!connected}
            placeholder={connected ? "••••••••••••••••" : "Paste your Canvas token"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {status && (
          <p className={`text-sm ${status.type === "error" ? "text-red-600" : "text-green-600"}`}>{status.message}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || (!token && !connected)}
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
    </section>
  );
}
