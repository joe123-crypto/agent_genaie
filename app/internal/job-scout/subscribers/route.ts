import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { httpError } from "@/src/lib/utils";
import { listJobScoutSubscribers, JobScoutSubscriberFilter } from "@/src/domains/job-scout";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const statusParam = String(req.nextUrl.searchParams.get("status") || "ready").trim();
    if (!["ready", "pending_conversion"].includes(statusParam)) {
      throw httpError(400, "status must be ready or pending_conversion.");
    }

    const subscribers = await listJobScoutSubscribers(limit, statusParam as JobScoutSubscriberFilter);
    return NextResponse.json({ subscribers });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
