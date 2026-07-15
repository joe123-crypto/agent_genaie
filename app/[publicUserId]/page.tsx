import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { buildDashboardViewModel } from "@/app/_components/dashboard-model";
import { DashboardOverview } from "@/app/_components/dashboard-overview";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { getSignedInAccountStatus, resolvePublicUser, syncUserToCentralData } from "@/src/domains/users";
import { getWebetuCredentialStatus } from "@/src/domains/webetu";
import { verifyFirebaseSessionCookie } from "@/src/security/session";

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

  const [accountResult, jobScoutResult, webetuResult] = await Promise.allSettled([
    getSignedInAccountStatus(uid),
    getJobScoutStatusForUser(uid),
    getWebetuCredentialStatus(uid),
  ]);
  const accountStatus = accountResult.status === "fulfilled" ? accountResult.value : null;
  const jobScoutStatus = jobScoutResult.status === "fulfilled" ? jobScoutResult.value : null;
  const webetuStatus = webetuResult.status === "fulfilled" ? webetuResult.value : null;
  const dashboard = buildDashboardViewModel({
    account: { available: accountResult.status === "fulfilled", data: accountStatus },
    jobScout: { available: jobScoutResult.status === "fulfilled", data: jobScoutStatus },
    publicUserId,
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
      <DashboardOverview {...dashboard} />
    </DashboardShell>
  );
}
