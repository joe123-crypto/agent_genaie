import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import {
  listJobApplications,
  listJobApplicationsByStatus,
  recordJobApplication,
} from "@/src/domains/job-scout";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const userId = req.nextUrl.searchParams.get("userId");
    const status = req.nextUrl.searchParams.get("status");
    const limit = req.nextUrl.searchParams.get("limit");
    if (userId && (status || limit)) {
      throw httpError(400, "userId cannot be combined with status or limit.");
    }
    if (!userId && !status) {
      throw httpError(400, "userId or status query parameter is required.");
    }

    const applications = userId
      ? await listJobApplications(userId)
      : await listJobApplicationsByStatus(status!, limit ?? 100);
    return NextResponse.json({ applications });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    if (!body.userId) throw new Error("userId is required in body");
    
    const result = await recordJobApplication(body);
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
