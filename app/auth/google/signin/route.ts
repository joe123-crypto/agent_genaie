import { NextRequest, NextResponse } from "next/server";
import { signState } from "@/src/security/crypto";
import { createPendingNonce } from "@/src/domains/pending-gmail-tokens";
import { config, assertPublicBaseUrl, GOOGLE_SIGNIN_SCOPES, AUTH_URL } from "@/src/config";
import { normalizeAccountLinkNextPath } from "@/src/lib/utils";

export const runtime = "nodejs";

// Unauthenticated twin of /auth/google/start: no Firebase UID exists yet, so the
// state carries a random nonce instead. The callback parks the Gmail tokens under
// that nonce and the browser claims them once it has traded Google's id_token for
// a Firebase session.
export async function POST(req: NextRequest) {
  try {
    assertPublicBaseUrl();

    const body = await req.json().catch(() => ({}));
    const payload = {
      flow: "signin",
      nonce: createPendingNonce(),
      next: normalizeAccountLinkNextPath(body.next),
      ts: Date.now(),
    };

    const stateStr = signState(payload);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_SIGNIN_SCOPES,
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
