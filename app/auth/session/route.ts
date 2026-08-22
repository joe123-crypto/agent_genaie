import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseIdToken, verifyFirebaseRequest, sessionCookieHeader } from "@/src/security/session";
import { assertNoDuplicateCentralEmail, syncUserToCentralData } from "@/src/domains/users";
import { isCvDownloadPending } from "@/src/domains/payment-proof";
import { getFirebaseAdminAuth } from "@/src/firebase/admin";
import { SESSION_COOKIE_MAX_AGE_SECONDS } from "@/src/config";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const decoded = await verifyFirebaseRequest(req);
    return NextResponse.json({ authenticated: true, uid: decoded.uid });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error", requestId },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  let stage = "read_request";
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.idToken) throw httpError(400, "idToken is required.");

    stage = "verify_id_token";
    const decoded = await verifyFirebaseIdToken(body.idToken);
    stage = "load_firebase_user";
    const auth = getFirebaseAdminAuth();
    const userRecord = await auth.getUser(decoded.uid);

    stage = "check_central_email";
    await assertNoDuplicateCentralEmail(userRecord);

    stage = "create_session_cookie";
    const expiresIn = SESSION_COOKIE_MAX_AGE_SECONDS * 1000;
    const sessionCookie = await auth.createSessionCookie(body.idToken, { expiresIn });

    stage = "sync_central_user";
    const syncResult = await syncUserToCentralData(decoded.uid);

    stage = "check_cv_download";
    // Best-effort: a hiccup here must never block sign-in, so fall back to false.
    const cvDownloadReady = await isCvDownloadPending(decoded.uid).catch(() => false);

    const response = NextResponse.json({
      ok: true,
      publicUserId: syncResult.publicUserId,
      isNewUser: syncResult.isNewUser,
      onboardingRequired: syncResult.onboardingRequired,
      plan: syncResult.plan,
      planRequired: syncResult.planRequired,
      cvDownloadReady,
    });
    response.headers.set("Set-Cookie", sessionCookieHeader(sessionCookie));
    return response;
  } catch (err: unknown) {
    const error = err as Error & { status?: number; code?: string };
    const status = error.status ?? 500;
    console.error("Firebase session creation failed", {
      requestId,
      stage,
      status,
      errorCode: error.code ?? error.name ?? "Error",
    });
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error", requestId },
      { status }
    );
  }
}
