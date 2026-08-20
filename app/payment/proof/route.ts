import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { sendGmailForTokenStoreKey, resolveOwnerTokenStoreKey } from "@/src/domains/gmail";
import { checkRateLimit, rateLimitKey } from "@/src/lib/rate-limit";
import { config } from "@/src/config";
import { escapeHtml, httpError } from "@/src/lib/utils";
import {
  assertPaymentMethod,
  createPaymentProof,
  detectImageType,
  paymentProofReviewToken,
  proofScreenshotFilename,
  PROOF_MAX_BYTES,
} from "@/src/domains/payment-proof";
import type { CvInput } from "@/src/domains/cv-html";

export const runtime = "nodejs";

// A payer uploads a screenshot of their manual EcoCash/Poste transfer plus the CV
// draft they want created. The proof is persisted and the admin is emailed a
// review link; the CV is only created once the admin approves (see
// app/payment/proof/decision/route.ts).
export async function POST(req: NextRequest) {
  try {
    const user = await verifyFirebaseRequest(req);

    const limit = await checkRateLimit(rateLimitKey("payment-proof", user.uid), 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      throw httpError(429, "Too many payment-proof uploads. Please try again later.");
    }

    const form = await req.formData();

    const method = assertPaymentMethod(form.get("method"));

    const cvRaw = form.get("cv");
    if (typeof cvRaw !== "string" || !cvRaw.trim()) {
      throw httpError(400, "cv is required.");
    }
    let cvInput: CvInput;
    try {
      cvInput = JSON.parse(cvRaw) as CvInput;
    } catch {
      throw httpError(400, "cv must be valid JSON.");
    }
    if (!cvInput || typeof cvInput !== "object") {
      throw httpError(400, "cv must be a JSON object.");
    }

    const screenshot = form.get("screenshot");
    if (!(screenshot instanceof File)) {
      throw httpError(400, "screenshot file is required.");
    }
    if (screenshot.size === 0) {
      throw httpError(400, "screenshot file is empty.");
    }
    if (screenshot.size > PROOF_MAX_BYTES) {
      throw httpError(413, "screenshot is too large (max 5 MB).");
    }
    const screenshotBytes = Buffer.from(await screenshot.arrayBuffer());
    const contentType = detectImageType(screenshotBytes);
    if (!contentType) {
      throw httpError(415, "screenshot must be a PNG, JPEG, or WebP image.");
    }

    const cv = cvInput as { fullName?: unknown; email?: unknown; phone?: unknown };
    const payer = {
      name: String(cv.fullName ?? user.name ?? "").trim(),
      email: String(cv.email ?? user.email ?? "").trim(),
      phone: String(cv.phone ?? "").trim(),
    };

    // Persist BEFORE emailing so an email failure never loses the proof.
    const { proofId } = await createPaymentProof({
      uid: user.uid,
      method,
      cvInput,
      screenshotBytes,
      screenshotContentType: contentType,
      payer,
    });

    const reviewUrl = `${config.publicBaseUrl}/payment/proof/decision?token=${encodeURIComponent(
      paymentProofReviewToken(proofId),
    )}`;

    const text = [
      `New payment proof submitted via ${method}.`,
      "",
      `Name: ${payer.name || "(none)"}`,
      `Email: ${payer.email || "(none)"}`,
      `Phone: ${payer.phone || "(none)"}`,
      "",
      "Review the screenshot and approve or deny the CV here:",
      reviewUrl,
    ].join("\n");

    const html = [
      `<p>New payment proof submitted via <strong>${escapeHtml(method)}</strong>.</p>`,
      "<ul>",
      `<li>Name: ${escapeHtml(payer.name || "(none)")}</li>`,
      `<li>Email: ${escapeHtml(payer.email || "(none)")}</li>`,
      `<li>Phone: ${escapeHtml(payer.phone || "(none)")}</li>`,
      "</ul>",
      `<p><a href="${escapeHtml(reviewUrl)}">Review the screenshot and approve or deny the CV</a></p>`,
    ].join("");

    try {
      await sendGmailForTokenStoreKey(resolveOwnerTokenStoreKey(), {
        to: config.paymentProofAdminEmail,
        subject: `Payment proof: ${payer.name || "Unknown"} (${method})`,
        text,
        html,
        attachments: [
          {
            filename: proofScreenshotFilename(contentType),
            contentBase64: screenshotBytes.toString("base64"),
            contentType,
          },
        ],
      });
    } catch {
      // The proof is already persisted; the admin can be re-notified on retry.
      throw httpError(502, "Proof saved but admin email failed; please retry.");
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
