import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function VaultRedirectPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect("/login?next=/vault");

  let uid: string;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
  } catch {
    redirect("/login?next=/vault");
  }

  await syncUserToCentralData(uid);
  const status = await getSignedInAccountStatus(uid).catch(() => null);
  if (status?.publicUserId) {
    const nextPath = `/${status.publicUserId}/vault`;
    if (!status.plan) redirect(pricingGatePath(nextPath));
    redirect(nextPath);
  }
  redirect("/login?next=/vault");
}
