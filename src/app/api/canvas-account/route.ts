import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";
import { CanvasApiError, CanvasClient, normalizeCanvasDomain } from "@/lib/canvas";

const connectSchema = z.object({
  domain: z.string().min(3),
  token: z.string().min(10),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.canvasAccount.findUnique({
    where: { userId: session.user.id },
    select: { domain: true, lastSyncedAt: true, lastSyncError: true, createdAt: true },
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

  const domain = normalizeCanvasDomain(parsed.data.domain);
  const client = new CanvasClient(domain, parsed.data.token);

  try {
    await client.validateCredentials();
  } catch (err) {
    const message = err instanceof CanvasApiError ? err.message : "Could not reach Canvas with those credentials";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const encryptedToken = encryptToken(parsed.data.token);

  await prisma.canvasAccount.upsert({
    where: { userId: session.user.id },
    update: { domain, encryptedToken, lastSyncError: null },
    create: { userId: session.user.id, domain, encryptedToken },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.canvasAccount.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
