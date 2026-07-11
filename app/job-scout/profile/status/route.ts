import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { syncUserToCentralData } from "@/src/domains/users";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await verifyFirebaseRequest(req);
    await syncUserToCentralData(user.uid);
    const status = await getJobScoutStatusForUser(user.uid);
    return NextResponse.json(status);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
