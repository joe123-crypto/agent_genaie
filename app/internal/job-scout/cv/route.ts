import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { httpError } from "@/src/lib/utils";
import { saveJobScoutCv, getJobScoutCvUrl, deleteJobScoutCv } from "@/src/domains/job-scout";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const form = await req.formData().catch(() => null);
    if (!form) throw httpError(400, "Expected multipart/form-data.");
    const file = form.get("file");
    if (!(file instanceof File)) throw httpError(400, "file field is required.");
    const userId = (form.get("userId") as string | null) ?? undefined;
    const phone = (form.get("phone") as string | null) ?? undefined;
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await saveJobScoutCv({
      userId,
      phone,
      bytes,
      contentType: file.type,
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

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) throw httpError(400, "userId is required.");
    const result = await getJobScoutCvUrl(userId);
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
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) throw httpError(400, "userId is required.");
    const result = await deleteJobScoutCv(userId);
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
