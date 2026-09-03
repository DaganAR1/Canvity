import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";
import { CanvasApiError, CanvasClient, normalizeCanvasDomain } from "@/lib/canvas";
import { normalizeFeedUrl, parseIcs } from "@/lib/ics";

// Two ways in. Token access is richer but many institutions disable student
// token generation entirely; the calendar feed works for everyone.
const connectSchema = z.discriminatedUnion("connectionType", [
  z.object({
    connectionType: z.literal("token"),
    domain: z.string().min(3),
    token: z.string().min(10),
  }),
  z.object({
    connectionType: z.literal("feed"),
    feedUrl: z.string().min(10),
  }),
]);

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.canvasAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      domain: true,
      connectionType: true,
      lastSyncedAt: true,
      lastSyncError: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ account });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  if (parsed.data.connectionType === "feed") {
    return connectFeed(session.user.id, parsed.data.feedUrl);
  }
  return connectToken(session.user.id, parsed.data.domain, parsed.data.token);
}

async function connectToken(userId: string, rawDomain: string, token: string) {
  const domain = normalizeCanvasDomain(rawDomain);
  const client = new CanvasClient(domain, token);

  try {
    await client.validateCredentials();
  } catch (err) {
    const message = err instanceof CanvasApiError ? err.message : "Could not reach Canvas with those credentials";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const encryptedToken = encryptToken(token);

  await prisma.canvasAccount.upsert({
    where: { userId },
    update: {
      domain,
      connectionType: "token",
      encryptedToken,
      encryptedFeedUrl: null,
      lastSyncError: null,
    },
    create: { userId, domain, connectionType: "token", encryptedToken },
  });

  return NextResponse.json({ ok: true, connectionType: "token" });
}

async function connectFeed(userId: string, rawUrl: string) {
  const feedUrl = normalizeFeedUrl(rawUrl);
  if (!feedUrl) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Canvas calendar feed URL. In Canvas go to Calendar → Calendar Feed, and copy the link — it should contain /feeds/calendars/.",
      },
      { status: 400 }
    );
  }

  // Verify the feed actually resolves before saving it, so a bad paste fails
  // here rather than silently producing an empty timeline later.
  try {
    const res = await fetch(feedUrl, { cache: "no-store", redirect: "follow" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Canvas returned ${res.status} for that feed URL. Copy a fresh link from Canvas → Calendar → Calendar Feed.` },
        { status: 400 }
      );
    }
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      return NextResponse.json({ error: "That URL didn't return a calendar." }, { status: 400 });
    }
    // An empty but valid calendar is fine — a student between terms has one.
    parseIcs(text);
  } catch {
    return NextResponse.json({ error: "Could not reach that feed URL." }, { status: 400 });
  }

  const domain = new URL(feedUrl).host;

  await prisma.canvasAccount.upsert({
    where: { userId },
    update: {
      domain,
      connectionType: "feed",
      encryptedFeedUrl: encryptToken(feedUrl),
      encryptedToken: null,
      lastSyncError: null,
    },
    create: {
      userId,
      domain,
      connectionType: "feed",
      encryptedFeedUrl: encryptToken(feedUrl),
    },
  });

  return NextResponse.json({ ok: true, connectionType: "feed" });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.canvasAccount.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
