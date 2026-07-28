import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { resolvePublicUser } from "@/src/domains/users";
import { getFirestoreDb } from "@/src/firebase/admin";
import {
  applicationArtifactObjectKey,
  type JobApplicationArtifactKind,
} from "@/src/domains/job-scout";
import { getPresignedGetUrl } from "@/src/domains/r2-storage";

export const runtime = "nodejs";

// Maps request `kind` values onto the field names used inside the stored
// jobApplications artifact records.
const KIND_FIELDS: Record<JobApplicationArtifactKind, "cv" | "coverLetterText" | "coverLetterPdf"> = {
  cv: "cv",
  cover_letter_text: "coverLetterText",
  cover_letter_pdf: "coverLetterPdf",
};

function notFound() {
  return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;
  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) return notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    return NextResponse.redirect(new URL(`/login?next=/${publicUserId}/applications/history`, req.url));
  }

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);
  if (!verified) {
    return NextResponse.redirect(new URL(`/login?next=/${publicUserId}/applications/history`, req.url));
  }
  // Only the owner of the route may download their own artifacts.
  if (!routeUser || verified.uid !== routeUser.id) return notFound();
  const uid = verified.uid;

  const applicationId = req.nextUrl.searchParams.get("applicationId") || "";
  const attempt = Number(req.nextUrl.searchParams.get("attempt"));
  const kind = String(req.nextUrl.searchParams.get("kind") || "") as JobApplicationArtifactKind;
  if (!Object.hasOwn(KIND_FIELDS, kind)) return notFound();

  let key: string;
  try {
    key = applicationArtifactObjectKey({ userId: uid, applicationId, attempt, kind });
  } catch {
    return notFound();
  }

  const doc = await getFirestoreDb().collection("jobApplications").doc(applicationId).get().catch(() => null);
  if (!doc || !doc.exists) return notFound();
  const data = doc.data() || {};
  if (String(data.userId || "") !== uid) return notFound();

  // Confirm the requested (attempt, kind) is actually recorded on the document,
  // so we never mint a URL for an artifact the agent never uploaded.
  const field = KIND_FIELDS[kind];
  const attemptArtifacts = data.artifacts && typeof data.artifacts === "object" ? data.artifacts[String(attempt)] : null;
  const storedRef = String(
    (attemptArtifacts && typeof attemptArtifacts === "object" ? attemptArtifacts[field] : "")
      || (data.artifactRefs && typeof data.artifactRefs === "object" && Number(data.artifactRefs.attempt) === attempt
        ? data.artifactRefs[field]
        : "")
      || "",
  ).trim();
  if (storedRef !== key) return notFound();

  const url = await getPresignedGetUrl(key).catch(() => null);
  if (!url) return notFound();
  return NextResponse.redirect(url, 302);
}
