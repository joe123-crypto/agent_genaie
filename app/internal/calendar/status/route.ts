import { NextRequest, NextResponse } from "next/server";
import { hasCalendarScope, loadGmailTokens } from "@/src/domains/gmail";
import { httpError, tokenStoreKeyForUid } from "@/src/lib/utils";
import { verifyInternalApiKey } from "@/src/security/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const senderUid = req.nextUrl.searchParams.get("senderUid");
    if (!senderUid) throw httpError(400, "senderUid query parameter is required.");

    const tokens = await loadGmailTokens(tokenStoreKeyForUid(senderUid));
    return NextResponse.json({
      connected: !!tokens,
      calendarConnected: hasCalendarScope(tokens),
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
