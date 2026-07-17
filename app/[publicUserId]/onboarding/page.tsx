import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import {
  completeOnboarding,
  getOnboardingStatus,
  scopedPathForOnboardingStep,
  selectOnboardingService,
} from "@/src/domains/onboarding";

export const runtime = "nodejs";

export default async function OnboardingPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;
  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const onboardingPath = `/${publicUserId}/onboarding`;
  const homePath = `/${publicUserId}`;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);
  const uid = verified.uid;
  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/onboarding`);
    redirect("/login");
  }

  const status = await getOnboardingStatus(uid);
  if (status.completed || status.skipped || !status.onboardingRequired) redirect(homePath);
  if (status.nextStep === "dashboard") {
    await completeOnboarding(uid);
    redirect(homePath);
  }
  if (status.nextStep !== "service_selection") redirect(scopedPathForOnboardingStep(publicUserId, status.nextStep));

  // Job Scout is the only publicly offered service, so the selection screen is
  // skipped: select it here and continue straight to the next onboarding step.
  const updated = await selectOnboardingService(uid, "jobs");
  if (updated.nextStep === "dashboard") {
    await completeOnboarding(uid);
    redirect(homePath);
  }
  redirect(scopedPathForOnboardingStep(publicUserId, updated.nextStep));
}
