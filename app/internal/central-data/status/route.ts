import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { tryCentralData } from "@/src/domains/central-data";
import { getFirestoreDb } from "@/src/firebase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    
    const status = await tryCentralData("Firestore Access Check", async () => {
      const db = getFirestoreDb();
      const snap = await db.collection("users").limit(1).get();
      return { connected: true, collectionsRead: !snap.empty || snap.empty };
    });
    
    return NextResponse.json({ centralData: status });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
