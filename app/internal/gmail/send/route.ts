import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { resolveInternalSender, sendGmailForTokenStoreKey } from "@/src/domains/gmail";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    
    if (body.confirm !== true) {
      throw httpError(400, "Safety constraint: confirm=true required.");
    }
    
    const senderKey = await resolveInternalSender(body);
    const result = await sendGmailForTokenStoreKey(senderKey, body);
    
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
