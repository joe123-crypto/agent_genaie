import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { syncUserToCentralData, updateSignedInDisplayName } from "@/src/domains/users";
import {
  getJobScoutCvFileRef,
  getJobScoutStatusForUser,
  saveJobScoutCv,
  saveJobScoutProfile,
} from "@/src/domains/job-scout";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

function requiredText(form: FormData, name: string, label: string) {
  const value = String(form.get(name) ?? "").replace(/\s+/g, " ").trim();
  if (!value) throw httpError(400, `${label} is required.`);
  if (value.length > 200) throw httpError(400, `${label} is too long.`);
  if (value.includes("\0")) throw httpError(400, `${label} is invalid.`);
  return value;
}

function countryCode(form: FormData) {
  const value = String(form.get("country") ?? "dz").replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!/^[a-z]{2}$/.test(value)) throw httpError(400, "Country must be a two-letter code.");
  return value;
}

function checked(form: FormData, name: string) {
  const value = form.get(name);
  return value === "true" || value === "on" || value === "1";
}

export async function POST(req: NextRequest) {
  try {
    const user = await verifyFirebaseRequest(req);
    await syncUserToCentralData(user.uid);

    const form = await req.formData().catch(() => null);
    if (!form) throw httpError(400, "Expected multipart/form-data.");

    const displayName = requiredText(form, "displayName", "Display name");
    const targetRole = requiredText(form, "targetRole", "Target role");
    const targetLocation = requiredText(form, "targetLocation", "Target location");
    const country = countryCode(form);
    if (!checked(form, "profileConfirmed")) throw httpError(400, "Profile confirmation is required.");
    if (!checked(form, "safetyAcknowledged")) throw httpError(400, "Scam-safety terms acknowledgement is required.");

    await updateSignedInDisplayName(user.uid, displayName);

    let cvFileRef = await getJobScoutCvFileRef(user.uid);
    const file = form.get("cv");
    if (file instanceof File && file.size > 0) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await saveJobScoutCv({
        userId: user.uid,
        bytes,
        contentType: file.type,
      });
      cvFileRef = result.key;
    }
    if (!cvFileRef) throw httpError(400, "CV file is required.");

    await saveJobScoutProfile({
      userId: user.uid,
      preferences: {
        targetRoles: [targetRole],
        locations: [targetLocation],
        country,
      },
      cvFileRef,
      profileConfirmed: true,
      safetyAcknowledged: true,
    });

    const status = await getJobScoutStatusForUser(user.uid);
    return NextResponse.json({ ok: true, ...status });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
