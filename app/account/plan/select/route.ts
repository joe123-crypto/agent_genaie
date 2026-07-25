import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import {
  getSignedInAccountStatus,
  selectSignedInPlan,
} from "@/src/domains/users";
import { safeNext } from "@/src/auth/login";

export const runtime = "nodejs";

function pricingRedirect(nextPath: string) {
  return `/pricing?next=${encodeURIComponent(nextPath)}`;
}

async function readPayload(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    return {
      plan: body.plan,
      next: body.next,
      wantsJson: true,
    };
  }

  const form = await req.formData();
  return {
    plan: form.get("plan"),
    next: form.get("next"),
    wantsJson: false,
  };
}

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const payload = await readPayload(req);
    const result = await selectSignedInPlan(decoded.uid, payload.plan);
    const account = await getSignedInAccountStatus(decoded.uid);
    const fallback = account.publicUserId ? `/${account.publicUserId}/onboarding` : "/";
    const destination = safeNext(String(payload.next ?? "")) || fallback;
    const nextUrl = destination === "/" ? fallback : destination;

    if (payload.wantsJson) {
      return NextResponse.json({ ok: true, ...result, destination: nextUrl });
    }
    return NextResponse.redirect(new URL(nextUrl, req.url), 303);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    const acceptsHtml = (req.headers.get("accept") || "").includes("text/html");
    if (acceptsHtml) {
      return NextResponse.redirect(new URL(pricingRedirect("/"), req.url), 303);
    }
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
