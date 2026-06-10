import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { getAccountLinkStatusForPhone } from "@/src/domains/account-link";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const phone = req.nextUrl.searchParams.get("phone");
    if (!phone) throw new Error("Missing phone query parameter");
    
    const result = await getAccountLinkStatusForPhone(phone);
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
