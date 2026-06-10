import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, config } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function ScopedOnboardingPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const onboardingPath = `/${publicUserId}/onboarding`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);

  let uid: string;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
  } catch {
    redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);
  }

  const routeUser = await resolvePublicUser(publicUserId);
  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/onboarding`);
    redirect("/login");
  }

  const htmlPath = path.join(process.cwd(), "public", "onboarding", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replaceAll("https://your-passbolt-domain.example", config.passboltPublicUrl.replace(/"/g, "&quot;"));

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
