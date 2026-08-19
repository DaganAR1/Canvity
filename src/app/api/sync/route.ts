import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncUserCanvasData } from "@/lib/sync";
import { CanvasApiError } from "@/lib/canvas";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncUserCanvasData(session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CanvasApiError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
