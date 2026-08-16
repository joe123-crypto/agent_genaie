import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | Create CV",
  description: "Build and customise the CV that Genaie will use when applying for jobs.",
};
import { FileUser, MessagesSquare } from "lucide-react";
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
  searchParams: Promise<{ onboarding?: string; from?: string }>;
}) {
  const { publicUserId } = await params;
  const query = await searchParams;
  const onboardingMode = query.onboarding === "1" || query.onboarding === "true";
  // Set by the chat interview handoff: only then does the form hydrate the
  // draft it stashed in sessionStorage, so a direct visit shows an empty form.
  const fromInterview = query.from === "interview";

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
  const email = (routeUser as { profile?: { email?: string } }).profile?.email ?? verified.email ?? "";
  const displayName =
    jobScoutStatus?.profile?.displayName
    ?? (routeUser as { profile?: { displayName?: string } }).profile?.displayName
    ?? verified.name
    ?? "";
  const userLabel = displayName || email;
  const suffix = onboardingMode ? "?onboarding=1" : "";
  const jobScoutPath = `/${publicUserId}/job-scout${suffix}`;
  const interviewPath = `/${publicUserId}/create-cv/interview${suffix}`;
  // Building the CV no longer requires a plan. Instead, the plan gate moves to
  // the end of the flow: a planless user is sent to pricing after the CV is
  // created, while someone who already has a plan continues to Job Scout setup.
  const successPath = accountStatus?.plan ? jobScoutPath : pricingGatePath(jobScoutPath);

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
      <div className="chat-switch">
        <span className="file-note">Prefer a conversation to filling forms?</span>
        <a className="chat-switch-link" href={interviewPath}>
          <MessagesSquare aria-hidden="true" />
          Build it by chatting instead
        </a>
      </div>
      <CreateCvForm
        jobScoutPath={jobScoutPath}
        successPath={successPath}
        hydrateDraft={fromInterview}
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
    <DashboardShell active="create-cv" publicUserId={publicUserId} userLabel={userLabel}>
      {panel}
    </DashboardShell>
  );
}
