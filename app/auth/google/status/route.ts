import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { loadGmailTokens } from "@/src/domains/gmail";
import { tokenStoreKeyForUid } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const storeKey = tokenStoreKeyForUid(decoded.uid);
    const tokens = await loadGmailTokens(storeKey);
    return NextResponse.json({
      connected: !!tokens,
      hasRefreshToken: !!tokens?.refresh_token,
      expiresAt: tokens?.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
