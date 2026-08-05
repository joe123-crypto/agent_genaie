import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | Create CV",
  description: "Build and customise the CV that Genaie will use when applying for jobs.",
};
import { FileUser } from "lucide-react";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";
import { CreateCvForm } from "./create-cv-form";

export const runtime = "nodejs";

export default async function CreateCvPage({
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
  const pagePath = `/${publicUserId}/create-cv`;

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
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/create-cv`);
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
  const jobScoutPath = `/${publicUserId}/job-scout${onboardingMode ? "?onboarding=1" : ""}`;

  const panel = (
    <section className="panel dashboard-form-panel" aria-labelledby="create-cv-title">
      <div className="panel-head">
        <div className="panel-head-title">
          <span className="panel-head-icon"><FileUser aria-hidden="true" /></span>
          <div>
            <h1 id="create-cv-title">Create your CV</h1>
            <p>Fill in your details and Job Scout will build a CV for you — no PDF needed.</p>
          </div>
        </div>
      </div>
      <CreateCvForm
        jobScoutPath={jobScoutPath}
        defaultFullName={displayName}
        defaultEmail={email}
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
    <DashboardShell active="job-scout" publicUserId={publicUserId} userLabel={userLabel}>
      {panel}
    </DashboardShell>
  );
}
