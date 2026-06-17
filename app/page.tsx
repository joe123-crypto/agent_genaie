import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function RootPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect("/login");

  let uid: string;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie, false);
    uid = user.uid;
  } catch {
    redirect("/login");
  }

  await syncUserToCentralData(uid);
  const status = await getSignedInAccountStatus(uid).catch(() => null);
  if (status?.publicUserId) redirect(`/${status.publicUserId}`);
  redirect("/login");
}
