import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { DashboardApplications } from "@/app/_components/dashboard-applications";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { summarizeApplications } from "@/app/_components/application-history-model";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { listJobApplications } from "@/src/domains/job-scout";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function ApplicationsPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const applicationsPath = `/${publicUserId}/applications`;
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(applicationsPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(applicationsPath)}`);
  if (!routeUser) notFound();

  const uid = verified.uid;
  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/applications`);
    redirect("/login");
  }

  const [accountResult, appsResult] = await Promise.allSettled([
    getSignedInAccountStatus(uid),
    listJobApplications(uid),
  ]);
  const accountStatus = accountResult.status === "fulfilled" ? accountResult.value : null;
  if (!accountStatus?.plan) redirect(pricingGatePath(applicationsPath));

  const apps = appsResult.status === "fulfilled" ? appsResult.value : [];
  const pendingCount = apps.filter((app: any) => app?.status === "pending_approval").length;
  const sentCount = summarizeApplications(apps).sent;

  const userLabel =
    accountStatus?.profile.displayName
    || accountStatus?.profile.email
    || verified.name
    || verified.email
    || "Account";

  return (
    <DashboardShell active="applications" publicUserId={publicUserId} userLabel={userLabel}>
      <DashboardApplications publicUserId={publicUserId} pendingCount={pendingCount} sentCount={sentCount} />
    </DashboardShell>
  );
}
