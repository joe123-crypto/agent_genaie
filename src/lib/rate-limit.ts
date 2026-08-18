import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getFirestoreDb } from "@/src/firebase/admin";

// Best-effort client IP for rate limiting. Behind the platform proxy the real
// client is the first entry of X-Forwarded-For; fall back to X-Real-IP and then
// a constant bucket so a missing header degrades to a shared (stricter) limit
// rather than no limit at all.
export function clientIpFromRequest(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

// Opaque, non-reversible bucket key. We never store raw IPs.
export function rateLimitKey(scope: string, identifier: string): string {
  const hash = crypto.createHash("sha256").update(`${scope}:${identifier}`).digest("hex").slice(0, 32);
  return `${scope}:${hash}`;
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

// Fixed-window counter in Firestore (collection `rateLimits`). Atomic via a
// transaction so concurrent turns from the same bucket can't overrun the cap.
// Fails open: if Firestore is unreachable we allow the request rather than break
// the feature for everyone on an infra blip.
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    const db = getFirestoreDb();
    const ref = db.collection("rateLimits").doc(key);
    const now = Date.now();
    return await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const data = snap.exists ? (snap.data() as { windowStart?: number; count?: number }) : null;
      const windowStart = typeof data?.windowStart === "number" ? data.windowStart : 0;
      const withinWindow = windowStart > 0 && now - windowStart < windowMs;
      const start = withinWindow ? windowStart : now;
      const count = withinWindow ? data?.count ?? 0 : 0;

      if (count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((start + windowMs - now) / 1000) };
      }
      t.set(ref, { windowStart: start, count: count + 1, updatedAt: now }, { merge: true });
      return { allowed: true, retryAfterSeconds: 0 };
    });
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
