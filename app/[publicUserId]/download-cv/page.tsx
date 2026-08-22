import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { hasApprovedPaymentProof } from "@/src/domains/payment-proof";
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
  // proof may have no plan, but approval is what finalized their CV HTML.
  if (!(await hasApprovedPaymentProof(uid))) redirect("/payment");

  return (
    <main className="app-main app-main-center">
      <div className="shell shell-narrow">
        <section className="panel panel-narrow dashboard-form-panel" aria-labelledby="download-cv-title">
          <h1 id="download-cv-title">Your CV is ready</h1>
          <p>Your payment has been approved. Download your CV as a PDF below.</p>
          <DownloadCvButton href={`${downloadPath}/pdf`} />
        </section>
      </div>
    </main>
  );
}
