import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { setWebetuRestaurantOverrideForPhone } from "@/src/domains/webetu";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    const result = await setWebetuRestaurantOverrideForPhone(body);
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
