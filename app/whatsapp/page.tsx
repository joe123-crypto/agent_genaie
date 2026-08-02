import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";

export const metadata: Metadata = {
  title: "Genaie | WhatsApp",
  description: "Link your WhatsApp number to receive Job Scout notifications and updates.",
};
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { pricingGatePath, syncUserToCentralData } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function WhatsAppHandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  const handoffPath = `/whatsapp${suffix}`;
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(handoffPath)}`);
  const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
  if (!verified) redirect(`/login?next=${encodeURIComponent(handoffPath)}`);

  const synced = await syncUserToCentralData(verified.uid);
  if (!synced.publicUserId) redirect("/login");
  if (!synced.plan && !token) {
    redirect(pricingGatePath(`/${synced.publicUserId}/whatsapp`));
  }
  redirect(`/${synced.publicUserId}/whatsapp${suffix}`);
}
