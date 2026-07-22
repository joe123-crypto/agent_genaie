import { NextRequest, NextResponse } from "next/server";
import { getUserResetInventory, resetUserAccount } from "@/src/domains/user-reset";
import { verifyInternalApiKey } from "@/src/security/session";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

function errorResponse(err: unknown) {
  const error = err as Error & { status?: number };
  return NextResponse.json(
    { ok: false, error: error.message ?? "Internal server error" },
    { status: error.status ?? 500 },
  );
}

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const phone = req.nextUrl.searchParams.get("phone");
    if (!phone) throw httpError(400, "phone is required.");
    return NextResponse.json(await getUserResetInventory(phone));
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await resetUserAccount(body));
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
