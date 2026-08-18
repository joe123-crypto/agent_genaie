import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getSignedInAccountStatus, syncUserToCentralData } from "@/src/domains/users";
import { CvInterview } from "@/app/[publicUserId]/create-cv/interview/cv-interview";

export const metadata: Metadata = {
  title: "Genaie | Build your CV",
  description: "Answer a few questions in a chat and Genaie builds your CV — no account needed to start.",
};

export const runtime = "nodejs";

// Public, sign-in-free entry to the CV interview. Visitors build a CV first and
// only sign in at the end to save it (see app/create-cv/page.tsx). Already
// signed-in users are sent to their account-scoped interview instead.
export default async function PublicCreateCvInterviewPage() {
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
    if (verified) {
      await syncUserToCentralData(verified.uid).catch(() => null);
      const status = await getSignedInAccountStatus(verified.uid).catch(() => null);
      if (status?.publicUserId) redirect(`/${status.publicUserId}/create-cv/interview`);
    }
  }

  return (
    <main className="app-main app-main-center">
      <div className="shell">
        <a className="toplink" href="/">Back home</a>
        <section className="panel dashboard-form-panel" aria-labelledby="cv-interview-title">
          <div className="panel-head">
            <div className="panel-head-title">
              <span className="panel-head-icon"><MessagesSquare aria-hidden="true" /></span>
              <h1 id="cv-interview-title">Build your CV by chatting</h1>
            </div>
          </div>
          <CvInterview formPath="/create-cv?from=interview" />
        </section>
      </div>
    </main>
  );
}
