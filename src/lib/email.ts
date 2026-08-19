import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set");
    client = new Resend(apiKey);
  }
  return client;
}

export interface DigestEntry {
  name: string;
  courseName: string;
  dueAt: Date | null;
  priorityTier: string;
  /** Items found in a syllabus are flagged, since they have no Canvas page to open. */
  fromSyllabus?: boolean;
}

export async function sendDigestEmail(to: string, entries: DigestEntry[]) {
  const from = process.env.EMAIL_FROM ?? "Canvity <notifications@canvity.app>";

  const rows = entries
    .map((a) => {
      const due = a.dueAt ? a.dueAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "No due date";
      const tierColor = { critical: "#dc2626", high: "#ea580c", normal: "#2563eb", low: "#64748b" }[a.priorityTier] ?? "#64748b";
      const badge = a.fromSyllabus
        ? ` <span style="font-size:10px;font-weight:600;color:#7e22ce;border:1px solid #d8b4fe;border-radius:3px;padding:1px 4px;text-transform:uppercase;">syllabus</span>`
        : "";
      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;color:#111827;">${escapeHtml(a.name)}${badge}</div>
            <div style="font-size:13px;color:#6b7280;">${escapeHtml(a.courseName)} &middot; ${due}</div>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;">
            <span style="font-size:12px;font-weight:600;color:${tierColor};text-transform:uppercase;">${a.priorityTier}</span>
          </td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#111827;">Your Canvity digest</h2>
      <p style="color:#4b5563;">Here's what's coming up, sorted by priority.</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>`;

  await getClient().emails.send({
    from,
    to,
    subject: `Canvity: ${entries.length} item${entries.length === 1 ? "" : "s"} on your radar`,
    html,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
