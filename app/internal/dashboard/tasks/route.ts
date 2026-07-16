import { NextRequest, NextResponse } from "next/server";
import { upsertDashboardTaskStatus } from "@/src/domains/dashboard";
import { verifyInternalApiKey } from "@/src/security/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    const result = await upsertDashboardTaskStatus(body);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status: error.status ?? 500 },
    );
  }
}
