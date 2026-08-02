import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/src/config";

export const metadata: Metadata = {
  title: "Genaie | Terms of Service",
  description: "Read the Genaie Terms of Service before using the platform.",
};
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function TermsOfServicePage() {
  let dashboardHref: string | null = null;
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    try {
      const { uid } = await verifyFirebaseSessionCookie(sessionCookie);
      const status = await getSignedInAccountStatus(uid).catch(() => null);
      if (status?.publicUserId) dashboardHref = `/${status.publicUserId}`;
    } catch {
      // invalid/expired session → treat as logged out
    }
  }

  return (
    <>
      <main className="app-main policy-page">
        <div className="shell">
          <header className="policy-card">
            <h1>Terms of Service</h1>
            <p>Effective date: 18 July 2026</p>
            <p>These terms govern your use of Genaie, an AI agent that searches for job openings and prepares and submits applications on your behalf. By using Genaie, you agree to these terms.</p>
            <div className="actions actions-spaced">
              {dashboardHref ? (
                <a className="button" href={dashboardHref}>Back to dashboard</a>
              ) : (
                <a className="button" href="/login">Sign in</a>
              )}
            </div>
          </header>
          <section className="policy-card">
            <h2>1. Acceptance of Terms</h2>
            <p>By creating an account or otherwise using Genaie, you confirm that you are legally able to enter into this agreement and that you accept these terms in full. If you do not agree, please do not use the service.</p>
            <p>Your continued use of Genaie after any change to these terms means that you accept the updated terms.</p>
          </section>
          <section className="policy-card">
            <h2>2. Description of Service</h2>
            <p>Genaie searches for job openings that match your profile and prepares and submits job applications on your behalf using your CV and your connected accounts.</p>
            <p>Genaie is a tool that automates parts of your job search. It does not act as an employer, recruiter, or employment agency, and it does not guarantee any particular result.</p>
          </section>
          <section className="policy-card">
            <h2>3. Your Account and Connected Services</h2>
            <p>To apply on your behalf, Genaie may use your Gmail (send-only) and, optionally, your linked WhatsApp number to deliver results and reminders.</p>
            <p>You are responsible for keeping these connections valid and for revoking any access you no longer wish to grant. For details on exactly how each permission is used, see our <a href="/privacy-policy">Privacy &amp; Policy</a>.</p>
          </section>
          <section className="policy-card">
            <h2>4. Your Responsibilities</h2>
            <p>You agree to provide accurate and truthful information in your CV and job profile. Because Genaie submits applications on your behalf, you are responsible for the content that is submitted under your name.</p>
            <p>You agree to use the service only to apply for roles you are genuinely interested in and eligible for.</p>
          </section>
          <section className="policy-card">
            <h2>5. Acceptable Use</h2>
            <p>You agree not to use Genaie for any unlawful purpose, to misrepresent your identity or qualifications, to spam employers, or to interfere with or attempt to disrupt the service or its infrastructure.</p>
          </section>
          <section className="policy-card">
            <h2>6. Third-Party Services</h2>
            <p>Genaie relies on and interacts with third parties such as Google, WhatsApp, job boards, and employers. These parties are independent of Genaie.</p>
            <p>We are not responsible for the availability, policies, decisions, or conduct of these third parties, including whether an employer responds to or acts on an application.</p>
          </section>
          <section className="policy-card">
            <h2>7. Scam Awareness</h2>
            <p>Genaie aggregates job listings from multiple job boards and WhatsApp groups. We do not vet, verify, or endorse the employers, recruiters, or contacts behind these listings, and scams and fraudulent listings are known to exist on these sources.</p>
            <p><strong>You acknowledge this risk and agree that you will never pay money to any employer, recruiter, or contact in connection with a job.</strong> Legitimate employers do not ask candidates to pay money upfront — for training, equipment, processing, placement, background checks, or any other reason.</p>
            <p>Any request for payment should be treated as a scam. Genaie is not liable for any loss you suffer as a result of paying money to such a party.</p>
          </section>
          <section className="policy-card">
            <h2>8. No Guarantee of Results</h2>
            <p>Genaie automates the process of finding and applying to jobs, but it does not guarantee interviews, responses, offers, or employment. Outcomes depend on employers and on factors outside our control.</p>
          </section>
          <section className="policy-card">
            <h2>9. Limitation of Liability</h2>
            <p>Genaie is provided on an "as is" and "as available" basis, without warranties of any kind. To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential losses.</p>
            <p>This includes, without limitation, losses arising from the outcomes of automated applications, from fraudulent or inaccurate listings, or from your decision to pay money to any third party (see Scam Awareness).</p>
          </section>
          <section className="policy-card">
            <h2>10. Indemnification</h2>
            <p>You agree to indemnify and hold Genaie harmless from any claims, damages, or expenses arising out of your use of the service, the content you submit, or your breach of these terms.</p>
          </section>
          <section className="policy-card">
            <h2>11. Changes to Terms</h2>
            <p>We may update these terms from time to time. When we do, we will update the effective date above. Your continued use of Genaie after a change means that you accept the updated terms.</p>
          </section>
          <section className="policy-card">
            <h2>12. Contact</h2>
            <p>If you have any questions about these terms, contact us at <a href="mailto:munemojoseph332@gmail.com">munemojoseph332@gmail.com</a> or on WhatsApp at <a href="https://wa.me/213563719936">+213 563 719 936</a>.</p>
          </section>
        </div>
      </main>
    </>
  );
}
