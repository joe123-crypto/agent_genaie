import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { listCentralGmailSenders, listLocalGmailSenders } from "@/src/domains/gmail";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    
    const central = await listCentralGmailSenders();
    const local = listLocalGmailSenders();
    
    const senders: Record<string, string[]> = { ...central };
    for (const [key, locations] of Object.entries(local)) {
      if (!senders[key]) senders[key] = [];
      for (const loc of locations) {
        if (!senders[key].includes(loc)) senders[key].push(loc);
      }
    }
    
    return NextResponse.json({ senders });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
