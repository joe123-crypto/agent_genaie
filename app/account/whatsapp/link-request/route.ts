import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { createSignedInWhatsAppLinkRequest } from "@/src/domains/account-link";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const body = await req.json().catch(() => ({}));
    const result = await createSignedInWhatsAppLinkRequest(decoded.uid, body.phone);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
