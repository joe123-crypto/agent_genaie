import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { selectOnboardingService } from "@/src/domains/onboarding";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const body = await req.json().catch(() => ({}));
    const status = await selectOnboardingService(decoded.uid, body.service);
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
