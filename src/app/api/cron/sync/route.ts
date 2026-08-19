import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { syncUserCanvasData } from "@/lib/sync";

// Pulls fresh Canvas data for every connected account. Runs a few times a day.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.canvasAccount.findMany({ select: { userId: true } });

  let succeeded = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      await syncUserCanvasData(account.userId);
      succeeded++;
    } catch {
      failed++; // syncUserCanvasData records the reason on the account itself
    }
  }

  return NextResponse.json({ accounts: accounts.length, succeeded, failed });
}
