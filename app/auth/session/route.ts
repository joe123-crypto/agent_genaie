import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseIdToken, verifyFirebaseRequest, sessionCookieHeader } from "@/src/security/session";
import { assertNoDuplicateCentralEmail, syncUserToCentralData } from "@/src/domains/users";
import { getFirebaseAdminAuth } from "@/src/firebase/admin";
import { SESSION_COOKIE_MAX_AGE_SECONDS } from "@/src/config";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    return NextResponse.json({ authenticated: true, uid: decoded.uid });
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
    const body = await req.json().catch(() => ({}));
    if (!body.idToken) throw httpError(400, "idToken is required.");

    const decoded = await verifyFirebaseIdToken(body.idToken);
    const auth = getFirebaseAdminAuth();
    const userRecord = await auth.getUser(decoded.uid);

    await assertNoDuplicateCentralEmail(userRecord);

    const expiresIn = SESSION_COOKIE_MAX_AGE_SECONDS * 1000;
    const sessionCookie = await auth.createSessionCookie(body.idToken, { expiresIn });

    const syncResult = await syncUserToCentralData(decoded.uid);

    const response = NextResponse.json({
      ok: true,
      publicUserId: syncResult.publicUserId,
      isNewUser: syncResult.isNewUser,
      onboardingRequired: syncResult.onboardingRequired,
    });
    response.headers.set("Set-Cookie", sessionCookieHeader(sessionCookie));
    return response;
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
