import { NextRequest, NextResponse } from "next/server";
import { getJobScoutStatusForPhone } from "@/src/domains/job-scout";
import { httpError } from "@/src/lib/utils";
import { verifyInternalApiKey } from "@/src/security/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const phone = req.nextUrl.searchParams.get("phone");
    if (!phone) throw httpError(400, "phone is required.");
    return NextResponse.json(await getJobScoutStatusForPhone(phone));
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status: error.status ?? 500 },
    );
  }
}
