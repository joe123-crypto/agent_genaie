import { NextRequest, NextResponse } from "next/server";
import { getPresignedGetUrl } from "@/src/domains/r2-storage";
import { httpError } from "@/src/lib/utils";
import {
  approvePaymentProof,
  denyPaymentProof,
  loadPaymentProof,
  verifyPaymentProofToken,
} from "@/src/domains/payment-proof";

export const runtime = "nodejs";

// This page is opened by the admin from the review-link email and rendered in a
// browser, so every response is HTML. GET is strictly side-effect-free (an email
// client prefetching the link must never approve a proof); only POST mutates.

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PAGE_STYLE =
  "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;" +
  "margin:2rem auto;padding:0 1rem;color:#111;line-height:1.5";

function htmlResponse(body: string, status = 200): NextResponse {
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8" />`
    + `<meta name="viewport" content="width=device-width, initial-scale=1" />`
    + `<title>Payment proof review</title></head>`
    + `<body style="${PAGE_STYLE}">${body}</body></html>`;
  return new NextResponse(doc, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function messagePage(title: string, detail: string, status = 200): NextResponse {
  return htmlResponse(`<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`, status);
}

async function renderReviewPage(token: string): Promise<NextResponse> {
  const proofId = verifyPaymentProofToken(token);
  const proof = await loadPaymentProof(proofId);
  if (!proof) {
    return messagePage("Proof not found or expired", "This payment proof could not be located.");
  }

  const imageUrl = await getPresignedGetUrl(proof.screenshotKey);
  const details = [
    `<li><strong>Method:</strong> ${escapeHtml(proof.method)}</li>`,
    `<li><strong>Name:</strong> ${escapeHtml(proof.payerName || "(none)")}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(proof.payerEmail || "(none)")}</li>`,
    `<li><strong>Phone:</strong> ${escapeHtml(proof.payerPhone || "(none)")}</li>`,
    `<li><strong>Status:</strong> ${escapeHtml(proof.status)}</li>`,
  ].join("");

  let actions = "";
  if (proof.status === "pending") {
    const safeToken = escapeHtml(token);
    const button = "padding:.6rem 1.2rem;font-size:1rem;border:0;border-radius:6px;color:#fff;cursor:pointer";
    actions = `<div style="display:flex;gap:1rem;margin-top:1rem">`
      + `<form method="post" action="/payment/proof/decision">`
      + `<input type="hidden" name="token" value="${safeToken}" />`
      + `<input type="hidden" name="action" value="approve" />`
      + `<button type="submit" style="${button};background:#137a3f">Approve</button>`
      + `</form>`
      + `<form method="post" action="/payment/proof/decision">`
      + `<input type="hidden" name="token" value="${safeToken}" />`
      + `<input type="hidden" name="action" value="deny" />`
      + `<button type="submit" style="${button};background:#b3261e">Deny</button>`
      + `</form>`
      + `</div>`;
  } else {
    actions = `<p>This proof has already been <strong>${escapeHtml(proof.status)}</strong>.</p>`;
  }

  const body = `<h1>Payment proof review</h1>`
    + `<p><img src="${escapeHtml(imageUrl)}" alt="Payment screenshot" `
    + `style="max-width:100%;height:auto;border:1px solid #ddd;border-radius:6px" /></p>`
    + `<ul>${details}</ul>`
    + actions;
  return htmlResponse(body);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    return await renderReviewPage(token);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return messagePage("Invalid review link", error.message ?? "Internal server error", error.status ?? 500);
  }
}

async function readDecision(req: NextRequest): Promise<{ token: string; action: string }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { token?: unknown; action?: unknown } | null;
    return { token: String(body?.token ?? ""), action: String(body?.action ?? "") };
  }
  const form = await req.formData();
  return { token: String(form.get("token") ?? ""), action: String(form.get("action") ?? "") };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { token, action } = await readDecision(req);
    const proofId = verifyPaymentProofToken(token);

    let status: "pending" | "approved" | "denied";
    if (action === "approve") {
      status = await approvePaymentProof(proofId);
    } else if (action === "deny") {
      status = await denyPaymentProof(proofId);
    } else {
      throw httpError(400, "action must be 'approve' or 'deny'.");
    }

    if (status === "approved") {
      return messagePage("Approved", "The payment proof was approved and the CV has been created.");
    }
    if (status === "denied") {
      return messagePage("Denied", "The payment proof was denied. No CV was created.");
    }
    return messagePage("Decision recorded", `The payment proof is currently ${status}.`);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return messagePage("Could not record decision", error.message ?? "Internal server error", error.status ?? 500);
  }
}
