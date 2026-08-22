import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { cvDownloadState, markCvDownloadPrompted } from "@/src/domains/payment-proof";
import { StatusNotice } from "@/app/_components/status-ui";
import { DownloadCvButton } from "./download-cv-button";

export const metadata: Metadata = {
  title: "Genaie | Download your CV",
  description: "Your payment is approved — download your CV as a PDF.",
};

export const runtime = "nodejs";

export default async function DownloadCvPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const downloadPath = `/${publicUserId}/download-cv`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(downloadPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(downloadPath)}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid).catch(() => null);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/download-cv`);
    redirect("/login");
  }

  // Gate on payment approval — NOT on a plan. Manual-payment users approved via
  // proof may have no plan, but approval is what finalized their CV HTML. The same
  // helper backs the PDF route, so the page can never offer a download the route
  // will refuse. On a read failure fall through to the "being prepared" panel
  // rather than 500ing or bouncing a paid user to /payment: it is the one state
  // whose copy is true no matter which way the lookup would have gone.
  const state = await cvDownloadState(uid).catch(() => "cv_not_ready" as const);
  if (state === "not_approved") redirect("/payment");

  // Actually reaching a working download page is what retires the one-time
  // post-login nudge. Marking it on the download instead would re-route every
  // future sign-in of anyone who looked and did not click — and this page is the
  // only thing they'd ever see. Marking it while the CV is not ready would be the
  // opposite mistake: retiring a nudge they never got the chance to act on.
  if (state === "ready") await markCvDownloadPrompted(uid).catch(() => undefined);

  const dashboardPath = `/${publicUserId}`;

  return (
    <main className="app-main app-main-center">
      <div className="shell shell-narrow">
        <section className="panel panel-narrow dashboard-form-panel" aria-labelledby="download-cv-title">
          {state === "ready" ? (
            <>
              <h1 id="download-cv-title">Your CV is ready</h1>
              <p>Your payment has been approved. Download your CV as a PDF below.</p>
              <DownloadCvButton href={`${downloadPath}/pdf`} />
            </>
          ) : (
            <>
              <h1 id="download-cv-title">Your CV is being prepared</h1>
              <p>We&apos;re getting your CV ready to download.</p>
              <StatusNotice kind="info" variant="block">
                Check back in a few minutes — this page will offer the download once your CV is ready.
              </StatusNotice>
            </>
          )}
          <div className="actions actions-spaced">
            <a className="button secondary" href={dashboardPath}>Go to your dashboard</a>
          </div>
        </section>
      </div>
    </main>
  );
}
