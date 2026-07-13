import { NextRequest, NextResponse } from "next/server";
import { startOrResumeOnboardingForPhone } from "@/src/domains/onboarding";
import { verifyInternalApiKey } from "@/src/security/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    const result = await startOrResumeOnboardingForPhone(body.phone, body.service, body.channel);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status: error.status ?? 500 },
    );
  }
}
