import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { DashboardSettings } from "@/app/_components/dashboard-settings";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { getSignedInAccountStatus, pricingGatePath, resolvePublicUser, syncUserToCentralData } from "@/src/domains/users";
import { verifyFirebaseSessionCookie } from "@/src/security/session";

export const runtime = "nodejs";

export default async function SettingsPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const settingsPath = `/${publicUserId}/settings`;
  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(settingsPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(settingsPath)}`);
  if (!routeUser) notFound();

  const uid = verified.uid;
  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/settings`);
    redirect("/login");
  }

  const accountStatus = await getSignedInAccountStatus(uid).catch(() => null);
  if (!accountStatus?.plan) redirect(pricingGatePath(settingsPath));
  const userLabel =
    accountStatus?.profile.displayName
    || accountStatus?.profile.email
    || verified.name
    || verified.email
    || "Account";

  return (
    <DashboardShell active="settings" publicUserId={publicUserId} userLabel={userLabel}>
      <DashboardSettings
        gmailConnected={accountStatus?.services.gmail === "connected"}
        publicUserId={publicUserId}
        statusAvailable={Boolean(accountStatus)}
        whatsappLinked={!!accountStatus?.whatsappLinked}
        whatsappMaskedPhone={accountStatus?.maskedPhone}
      />
    </DashboardShell>
  );
}
