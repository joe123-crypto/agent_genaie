import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import {
  bindAccountLinkInviteToUser,
  createSignedInWhatsAppLinkRequest,
} from "@/src/domains/account-link";
import { syncUserToCentralData } from "@/src/domains/users";
import {
  completeOnboarding,
  getOnboardingStatus,
  scopedPathForOnboardingStep,
} from "@/src/domains/onboarding";
import { scopedPathForAccountLink } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const body = await req.json().catch(() => ({}));
    if (typeof body.token === "string" && body.token.trim()) {
      await syncUserToCentralData(decoded.uid);
      const result = await bindAccountLinkInviteToUser(body.token.trim(), decoded);
      let destination = result.publicUserId
        ? scopedPathForAccountLink(result.nextPath || "/", result.publicUserId)
        : "/";

      if (result.publicUserId && result.onboardingService && result.onboardingChannel) {
        let onboarding = await getOnboardingStatus(decoded.uid);
        if (onboarding.nextStep === "dashboard" && onboarding.onboardingRequired) {
          onboarding = await completeOnboarding(decoded.uid);
        }
        destination = scopedPathForOnboardingStep(result.publicUserId, onboarding.nextStep);
      }

      return NextResponse.json({ ...result, destination });
    }
    const result = await createSignedInWhatsAppLinkRequest(decoded.uid, body.phone, {
      nextPath: body.onboarding === true ? "/onboarding" : undefined,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
