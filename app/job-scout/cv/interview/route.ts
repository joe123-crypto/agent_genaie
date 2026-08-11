import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { syncUserToCentralData } from "@/src/domains/users";
import {
  runCvInterviewTurn,
  type InterviewData,
  type InterviewMessage,
} from "@/src/domains/cv-interview-ai";
import { openRouterConfigured } from "@/src/lib/openrouter";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

// Drives one turn of the AI CV interview. The browser posts the transcript so far
// plus the CV collected so far; we return the assistant's next message and the
// updated CV. This mirrors the auth + error shape of the sibling create route
// (app/job-scout/cv/create/route.ts) and is called with credentials:"same-origin".
//
// Whenever the AI can't serve a turn — no key, or any OpenRouter/parse failure —
// we return 503 { aiUnavailable: true } so the client silently drops to its
// scripted interview flow. An AI hiccup must never look like a hard error to the
// user mid-conversation.
export async function POST(req: NextRequest) {
  try {
    const user = await verifyFirebaseRequest(req);
    await syncUserToCentralData(user.uid);

    if (!openRouterConfigured()) {
      return NextResponse.json({ ok: false, aiUnavailable: true }, { status: 503 });
    }

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      throw httpError(400, "Expected a JSON body.");
    }
    const { messages, data } = payload as {
      messages?: InterviewMessage[];
      data?: InterviewData;
    };
    if (!Array.isArray(messages) || !data || typeof data !== "object") {
      throw httpError(400, "Expected { messages, data }.");
    }

    try {
      const turn = await runCvInterviewTurn(messages, data);
      return NextResponse.json({ ok: true, ...turn });
    } catch (aiErr) {
      // OpenRouter error, timeout, or unparseable completion — fall back. Log the
      // reason: without this the collapse to the scripted flow is invisible.
      console.warn(
        "[cv-interview] AI turn failed, falling back to scripted flow:",
        aiErr instanceof Error ? aiErr.message : aiErr,
      );
      return NextResponse.json({ ok: false, aiUnavailable: true }, { status: 503 });
    }
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
