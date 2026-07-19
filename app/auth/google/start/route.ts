import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { signState } from "@/src/security/crypto";
import { syncUserToCentralData } from "@/src/domains/users";
import { config, assertPublicBaseUrl, GOOGLE_OAUTH_SCOPES, AUTH_URL } from "@/src/config";
import { normalizeAccountLinkNextPath } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertPublicBaseUrl();
    const decoded = await verifyFirebaseRequest(req);
    await syncUserToCentralData(decoded.uid);

    const body = await req.json().catch(() => ({}));
    const payload = {
      uid: decoded.uid,
      next: normalizeAccountLinkNextPath(body.next),
      ts: Date.now(),
    };

    const stateStr = signState(payload);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_OAUTH_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state: stateStr,
    });

    return NextResponse.json({ url: `${AUTH_URL}?${params.toString()}` });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
