import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | CV Interview",
  description: "Answer a few questions in a chat and Genaie builds your CV from your answers.",
};
import { MessagesSquare } from "lucide-react";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";
import { CvInterview } from "./cv-interview";

export const runtime = "nodejs";

export default async function CreateCvInterviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicUserId: string }>;
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { publicUserId } = await params;
  const query = await searchParams;
  const onboardingMode = query.onboarding === "1" || query.onboarding === "true";

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const pagePath = `/${publicUserId}/create-cv/interview`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(pagePath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(pagePath)}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/create-cv/interview`);
    redirect("/login");
  }

  await syncUserToCentralData(uid);
  const [accountStatus, jobScoutStatus] = await Promise.all([
    getSignedInAccountStatus(uid).catch(() => null),
    getJobScoutStatusForUser(uid).catch(() => null),
  ]);
  if (!accountStatus?.plan) redirect(pricingGatePath(pagePath));

  const email = (routeUser as { profile?: { email?: string } }).profile?.email ?? verified.email ?? "";
  const displayName =
    jobScoutStatus?.profile?.displayName
    ?? (routeUser as { profile?: { displayName?: string } }).profile?.displayName
    ?? verified.name
    ?? "";
  const userLabel = displayName || email;
  const suffix = onboardingMode ? "?onboarding=1" : "";
  const jobScoutPath = `/${publicUserId}/job-scout${suffix}`;
  const formPath = `/${publicUserId}/create-cv${suffix}`;

  const panel = (
    <section className="panel dashboard-form-panel" aria-labelledby="cv-interview-title">
      <div className="panel-head">
        <div className="panel-head-title">
          <span className="panel-head-icon"><MessagesSquare aria-hidden="true" /></span>
          <h1 id="cv-interview-title">Build your CV by chatting</h1>
        </div>
      </div>
      <CvInterview
        jobScoutPath={jobScoutPath}
        formPath={formPath}
        displayName={displayName}
        email={email}
      />
    </section>
  );

  if (onboardingMode) {
    return (
      <main className="app-main app-main-center">
        <div className="shell">
          <OnboardingProgress backHref={jobScoutPath} current={2} total={2} />
          {panel}
        </div>
      </main>
    );
  }

  return (
    <DashboardShell active="create-cv" publicUserId={publicUserId} userLabel={userLabel}>
      {panel}
    </DashboardShell>
  );
}
