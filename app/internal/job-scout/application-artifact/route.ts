import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import {
  saveJobApplicationArtifact,
  type JobApplicationArtifactKind,
} from "@/src/domains/job-scout";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const form = await req.formData().catch(() => null);
    if (!form) throw httpError(400, "Expected multipart/form-data.");
    const file = form.get("file");
    if (!(file instanceof File)) throw httpError(400, "file field is required.");
    const userId = String(form.get("userId") || "").trim();
    const applicationId = String(form.get("applicationId") || "").trim();
    const attempt = Number(form.get("attempt"));
    const kind = String(form.get("kind") || "").trim() as JobApplicationArtifactKind;
    if (!userId || !applicationId || !kind) {
      throw httpError(400, "userId, applicationId, attempt, and kind are required.");
    }
    const result = await saveJobApplicationArtifact({
      userId,
      applicationId,
      attempt,
      kind,
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json(
      { ok: false, error: error.message || "Internal server error" },
      { status: error.status ?? 500 },
    );
  }
}
