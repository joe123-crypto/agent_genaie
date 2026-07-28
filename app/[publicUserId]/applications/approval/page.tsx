import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { ApplicationApproval } from "@/app/_components/application-approval";
import { buildApplicationHistory } from "@/app/_components/application-history-model";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusNotice } from "@/app/_components/status-ui";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { getJobScoutStatusForUser, listJobApplications } from "@/src/domains/job-scout";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function ApplicationApprovalPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const approvalPath = `/${publicUserId}/applications/approval`;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(approvalPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(approvalPath)}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/applications/approval`);
    redirect("/login");
  }

  await syncUserToCentralData(uid);
  const [accountResult, appsResult, jobScoutResult] = await Promise.allSettled([
    getSignedInAccountStatus(uid),
    listJobApplications(uid),
    getJobScoutStatusForUser(uid),
  ]);
  const accountStatus = accountResult.status === "fulfilled" ? accountResult.value : null;
  if (!accountStatus?.plan) redirect(pricingGatePath(approvalPath));

  const apps = appsResult.status === "fulfilled" ? appsResult.value : [];
  const jobScoutStatus = jobScoutResult.status === "fulfilled" ? jobScoutResult.value : null;
  const autoApply = jobScoutStatus?.preferences?.autoApply === true;
  const pending = buildApplicationHistory(apps, publicUserId).rows.filter(
    (row) => row.status === "pending_approval",
  );

  const userLabel =
    accountStatus?.profile.displayName
    || accountStatus?.profile.email
    || verified.name
    || verified.email
    || "Account";

  return (
    <DashboardShell active="applications" publicUserId={publicUserId} userLabel={userLabel}>
      {autoApply ? (
        <StatusNotice kind="info" variant="block">
          Automatic submission is on, so your agent applies without waiting for approval. Turn it off in Job Scout setup if you want to approve each job here.
        </StatusNotice>
      ) : null}
      <ApplicationApproval rows={pending} />
    </DashboardShell>
  );
}
