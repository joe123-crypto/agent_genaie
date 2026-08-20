import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FileUser, MessagesSquare } from "lucide-react";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getSignedInAccountStatus, syncUserToCentralData } from "@/src/domains/users";
import { CreateCvForm } from "@/app/[publicUserId]/create-cv/create-cv-form";

export const metadata: Metadata = {
  title: "Genaie | Create your CV",
  description: "Fill in your details and Genaie builds your CV — sign in at the end to save it.",
};

export const runtime = "nodejs";

// Public, sign-in-free CV form. On "Create CV" the visitor is sent to login and
// the account-scoped form finishes the save (deferred mode). Already signed-in
// users are redirected to their scoped form, carrying the interview handoff query.
export default async function PublicCreateCvPage({
  searchParams,
}: {
  // A repeated query key (e.g. ?from=interview&from=interview) arrives as an
  // array, so accept string | string[] and read the first value below.
  searchParams: Promise<{ from?: string | string[]; save?: string | string[] }>;
}) {
  const query = await searchParams;
  const firstParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const fromInterview = firstParam(query.from) === "interview";

  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
    if (verified) {
      await syncUserToCentralData(verified.uid).catch(() => null);
      const status = await getSignedInAccountStatus(verified.uid).catch(() => null);
      if (status?.publicUserId) {
        const params = new URLSearchParams();
        if (fromInterview) params.set("from", "interview");
        if (firstParam(query.save) === "1") params.set("save", "1");
        const suffix = params.toString() ? `?${params.toString()}` : "";
        redirect(`/${status.publicUserId}/create-cv${suffix}`);
      }
    }
  }

  return (
    <main className="app-main app-main-center">
      <div className="shell">
        <a className="toplink" href="/">Back home</a>
        <section className="panel dashboard-form-panel" aria-labelledby="create-cv-title">
          <div className="panel-head">
            <div className="panel-head-title">
              <span className="panel-head-icon"><FileUser aria-hidden="true" /></span>
              <div>
                <h1 id="create-cv-title">Create your CV</h1>
                <p>Fill in your details, then sign in to save your CV — no PDF needed.</p>
              </div>
            </div>
          </div>
          <div className="chat-switch">
            <span className="file-note">Prefer a conversation to filling forms?</span>
            <a className="chat-switch-link" href="/create-cv/interview">
              <MessagesSquare aria-hidden="true" />
              Build it by chatting instead
            </a>
          </div>
          <CreateCvForm
            jobScoutPath="/"
            saveMode="deferred"
            hydrateDraft={fromInterview}
            persistDraft
          />
        </section>
      </div>
    </main>
  );
}
