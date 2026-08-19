import { NextRequest } from "next/server";

/** Vercel Cron (and manual curl testing) authenticate with `Authorization: Bearer <CRON_SECRET>`. */
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}
