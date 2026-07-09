import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { saveJobScoutProfile, resetJobScoutProfileForPhone } from "@/src/domains/job-scout";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    
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

export async function DELETE(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const phone = req.nextUrl.searchParams.get("phone");
    if (!phone) throw httpError(400, "phone is required.");
    const result = await resetJobScoutProfileForPhone(phone);
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
