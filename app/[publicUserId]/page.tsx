import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | Overview",
  description: "Your Job Scout dashboard overview — current service health, tasks, and activity.",
};
import { buildDashboardViewModel } from "@/app/_components/dashboard-model";
import { DashboardOverview } from "@/app/_components/dashboard-overview";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { summarizeApplications } from "@/app/_components/application-history-model";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { listDashboardTasksForUser } from "@/src/domains/dashboard";
import { getJobScoutStatusForUser, listJobApplications } from "@/src/domains/job-scout";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";
import { getWebetuCredentialStatus } from "@/src/domains/webetu";

export const runtime = "nodejs";

export default async function DashboardPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=/${publicUserId}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=/${publicUserId}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}`);
    redirect("/login");
  }

  const [accountResult, jobScoutResult, webetuResult, telemetryResult, applicationsResult] = await Promise.allSettled([
    getSignedInAccountStatus(uid),
    getJobScoutStatusForUser(uid),
    getWebetuCredentialStatus(uid),
    listDashboardTasksForUser(uid),
    listJobApplications(uid),
  ]);
  const accountStatus = accountResult.status === "fulfilled" ? accountResult.value : null;
  if (!accountStatus?.plan) redirect(pricingGatePath(`/${publicUserId}`));
  const jobScoutStatus = jobScoutResult.status === "fulfilled" ? jobScoutResult.value : null;
  const webetuStatus = webetuResult.status === "fulfilled" ? webetuResult.value : null;
  const telemetry = telemetryResult.status === "fulfilled" ? telemetryResult.value : null;
  const applicationStats = summarizeApplications(applicationsResult.status === "fulfilled" ? applicationsResult.value : []);
  const dashboard = buildDashboardViewModel({
    account: { available: accountResult.status === "fulfilled", data: accountStatus },
    jobScout: { available: jobScoutResult.status === "fulfilled", data: jobScoutStatus },
    publicUserId,
    telemetry: { available: telemetryResult.status === "fulfilled", data: telemetry },
    webetu: { available: webetuResult.status === "fulfilled", data: webetuStatus },
  });

  const userLabel =
    accountStatus?.profile.displayName
    || accountStatus?.profile.email
    || verified.name
    || verified.email
    || "Account";

  return (
    <DashboardShell active="overview" publicUserId={publicUserId} userLabel={userLabel}>
      <DashboardOverview {...dashboard} applicationStats={applicationStats} publicUserId={publicUserId} />
    </DashboardShell>
  );
}
