import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { ApplicationHistory } from "@/app/_components/application-history";
import { buildApplicationHistory } from "@/app/_components/application-history-model";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { listJobApplications } from "@/src/domains/job-scout";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function ApplicationHistoryPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=/${publicUserId}/application-history`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=/${publicUserId}/application-history`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/application-history`);
    redirect("/login");
  }

  const [accountResult, appsResult] = await Promise.allSettled([
    getSignedInAccountStatus(uid),
    listJobApplications(uid),
  ]);
  const accountStatus = accountResult.status === "fulfilled" ? accountResult.value : null;
  if (!accountStatus?.plan) redirect(pricingGatePath(`/${publicUserId}/application-history`));
  const apps = appsResult.status === "fulfilled" ? appsResult.value : [];
  const history = buildApplicationHistory(apps, publicUserId);

  const userLabel =
    accountStatus?.profile.displayName
    || accountStatus?.profile.email
    || verified.name
    || verified.email
    || "Account";

  return (
    <DashboardShell active="application-history" publicUserId={publicUserId} userLabel={userLabel}>
      <ApplicationHistory rows={history.rows} />
    </DashboardShell>
  );
}
