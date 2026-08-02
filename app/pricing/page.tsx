import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Pricing } from "@/app/_components/pricing";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { getSignedInAccountStatus, normalizeUserPlan, syncUserToCentralData } from "@/src/domains/users";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { safeNext } from "@/src/auth/login";

export const metadata: Metadata = {
  title: "Genaie | Pricing",
  description:
    "Choose the Genaie plan that matches your job hunt pace before setting up Job Scout.",
};

export const runtime = "nodejs";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const query = await searchParams;
  const requestedNext = safeNext(query.next);
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  let selectedPlan = null;
  let publicUserId: string | null = null;
  if (sessionCookie) {
    const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
    if (verified) {
      await syncUserToCentralData(verified.uid).catch(() => null);
      const status = await getSignedInAccountStatus(verified.uid).catch(() => null);
      selectedPlan = normalizeUserPlan(status?.plan);
      publicUserId = status?.publicUserId ?? null;
    }
  }

  const nextHref = requestedNext === "/" && publicUserId
    ? `/${publicUserId}/onboarding`
    : requestedNext;

  if (sessionCookie && publicUserId && selectedPlan && requestedNext === "/pricing") {
    redirect(`/${publicUserId}`);
  }

  return (
    <main className="pricing-page">
      <header className="pricing-page-header">
        <a className="toplink" href="/">
          Back home
        </a>
        <h1>Pricing</h1>
        <p>
          Select a plan to continue setup.
        </p>
      </header>
      <Pricing
        className="pricing-page-section"
        mode={publicUserId ? "selection" : "marketing"}
        nextHref={nextHref}
        selectedPlan={selectedPlan}
        titleId="pricing-page-title"
      />
    </main>
  );
}
