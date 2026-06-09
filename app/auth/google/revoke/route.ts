import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { deleteUserTokens } from "@/src/domains/local-store";
import { mirrorGmailConnectionToCentralData, postForm, loadGmailTokens } from "@/src/domains/gmail";
import { tokenStoreKeyForUid } from "@/src/lib/utils";
import { REVOKE_URL } from "@/src/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const storeKey = tokenStoreKeyForUid(decoded.uid);
    const tokens = await loadGmailTokens(storeKey);

    if (tokens?.refresh_token || tokens?.access_token) {
      try {
        await postForm(REVOKE_URL, { token: tokens.refresh_token || tokens.access_token });
      } catch (err: any) {
        console.warn("Google token revocation failed upstream:", err.message);
      }
    }

    deleteUserTokens(storeKey);
    await mirrorGmailConnectionToCentralData(decoded.uid, null, { isDisconnect: true });

    return NextResponse.json({ revoked: true });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
