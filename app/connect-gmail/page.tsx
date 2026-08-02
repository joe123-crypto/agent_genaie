import type { Metadata } from "next";
import { pageMetadata } from "@/src/lib/site-metadata";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";

export const metadata: Metadata = pageMetadata({
  title: "Genaie | Connect Gmail",
  description:
    "Link your Gmail account so Genaie can send job applications on your behalf.",
  path: "/connect-gmail",
});
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function ConnectGmailRedirectPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect("/login?next=/connect-gmail");

  let uid: string;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
  } catch {
    redirect("/login?next=/connect-gmail");
  }

  await syncUserToCentralData(uid);
  const status = await getSignedInAccountStatus(uid).catch(() => null);
  if (status?.publicUserId) {
    const nextPath = `/${status.publicUserId}/connect-gmail`;
    if (!status.plan) redirect(pricingGatePath(nextPath));
    redirect(nextPath);
  }
  redirect("/login?next=/connect-gmail");
}
