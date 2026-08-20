import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isValidTimeZone } from "@/lib/timezone";

const settingsSchema = z.object({
  digestEnabled: z.boolean().optional(),
  // Interpreted in the user's own timeZone, not UTC — "7" means 7am for them.
  digestHour: z.number().int().min(0).max(23).optional(),
  timeZone: z
    .string()
    .refine(isValidTimeZone, { message: "Unrecognized timezone" })
    .optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: parsed.data,
    select: { digestEnabled: true, digestHour: true, timeZone: true },
  });

  return NextResponse.json({ user });
}
