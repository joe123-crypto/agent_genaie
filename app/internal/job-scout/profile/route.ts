import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { saveJobScoutProfile } from "@/src/domains/job-scout";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    if (!body.userId) throw new Error("userId is required");
    
    const result = await saveJobScoutProfile(body);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
