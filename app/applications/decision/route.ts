import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { syncUserToCentralData } from "@/src/domains/users";
import { decideJobApplication } from "@/src/domains/job-scout";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await verifyFirebaseRequest(req);
    await syncUserToCentralData(user.uid);

    const body = await req.json().catch(() => ({}));
    const decision = String(body.decision ?? "").trim();
    if (decision !== "approve" && decision !== "reject") {
      throw httpError(400, "decision must be approve or reject.");
    }

    const result = await decideJobApplication({
      userId: user.uid,
      applicationId: String(body.applicationId ?? ""),
      decision,
    });
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
