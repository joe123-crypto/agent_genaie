import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/src/config";

export const metadata: Metadata = {
  title: "Genaie | Privacy Policy",
  description: "How Genaie collects, uses, and protects your personal data.",
};
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function PrivacyPolicyPage() {
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
            <h1>Privacy &amp; Policy</h1>
            <p>This policy explains what information Genaie collects, how it is used, and the choices you have. Genaie is an AI agent that searches and applies for jobs on your behalf and reports each application to your WhatsApp.</p>
            <p>Last updated: July 18, 2026</p>
            <div className="actions actions-spaced">
              {dashboardHref ? (
                <a className="button" href={dashboardHref}>Back to dashboard</a>
              ) : (
                <a className="button" href="/login">Sign in</a>
              )}
            </div>
          </header>
          <section className="policy-card">
            <h2>Scope</h2>
            <p>This policy applies to the Genaie website, the signed-in dashboard, and the job-application agent that runs on your behalf. It covers the information you provide when you create an account and set up Job Scout, as well as the information Genaie generates as it works for you.</p>
            <p>It does not cover third-party websites or job boards that the agent visits or submits applications to. Those services are governed by their own privacy policies.</p>
          </section>
          <section className="policy-card">
            <h2>Account information</h2>
            <p>When you sign in, Genaie collects the information needed to create and secure your account. This includes your email address, and, if you sign in with Google, your display name and profile photo.</p>
            <p>Authentication is handled through Firebase. Your session is kept in a secure, HttpOnly cookie so you stay signed in, and no password is stored by Genaie when you use email-link or Google sign-in.</p>
          </section>
          <section className="policy-card">
            <h2>Your CV and job profile</h2>
            <p>To apply for jobs on your behalf, Genaie collects your CV and your job preferences, such as your target role, target location, country, and how many applications the agent may submit per run.</p>
            <p>Your uploaded PDF is stored securely while it is converted into an editable HTML CV. The HTML CV is used only to match you to openings and prepare tailored applications. Private copies of the exact CV and cover letter sent for an application may be retained with that application record for audit and deletion. This information is not shared beyond the applications the agent submits for you. You can replace or remove your CV at any time from the Job Scout page.</p>
          </section>
          <section className="policy-card">
            <h2>WhatsApp</h2>
            <p>Linking WhatsApp is optional. If you link a number, it is used only to deliver job search results, application reports, and setup reminders.</p>
            <p>Your number is stored in a hashed form and shown masked in the interface. You can unlink it at any time from Settings.</p>
          </section>
          <section className="policy-card">
            <h2>Gmail permission</h2>
            <p>The Gmail permission requested by Genaie is send-only. It allows the agent to send emails on your behalf so it can complete job applications.</p>
            <p>This permission is not used to read your emails. It is not used for anything other than sending job application emails for services you have enabled.</p>
            <h3>Revoking access</h3>
            <p>You can revoke Gmail access at any time from the Connect Gmail page. You are encouraged to revoke permissions that you no longer need.</p>
          </section>
          <section className="policy-card">
            <h2>Job application records</h2>
            <p>As the agent works, Genaie records details of each application so you can review what was done for you. A record may include the company and role, the application status, the email address used to apply, the source and application links, and timestamps.</p>
            <p>These records are kept so you have an accurate history of the applications submitted on your behalf and can follow up on them.</p>
          </section>
          <section className="policy-card">
            <h2>How information is used</h2>
            <p>Genaie uses the information it collects to:</p>
            <p>&bull; Provide and operate the service, including your account and dashboard.</p>
            <p>&bull; Search for openings and apply for jobs on your behalf using your CV and preferences.</p>
            <p>&bull; Report application results and send setup reminders, including over WhatsApp when linked.</p>
            <p>&bull; Secure your account, prevent abuse, and maintain the reliability of the service.</p>
            <p>&bull; Comply with legal obligations where required.</p>
          </section>
          <section className="policy-card">
            <h2>Service providers and disclosures</h2>
            <p>Genaie relies on a small number of trusted providers to run the service: Google Firebase and Firestore for authentication and data storage, Cloudflare R2 for storing your CV file, Google APIs for the Gmail feature described above, Vercel for hosting and basic usage analytics, and WhatsApp for delivering messages you have opted into.</p>
            <p>Genaie does not sell your personal information. Information is disclosed only to these providers as needed to run the service, or where required by law.</p>
          </section>
          <section className="policy-card">
            <h2>Retention and security</h2>
            <p>Your information is retained while your account is active so the service can keep working for you. Sensitive data, such as Google access tokens and stored credentials, is encrypted at rest.</p>
            <p>When you remove your CV, unlink WhatsApp, revoke Google access, or delete your account, the associated data is removed. You can also contact us to request deletion.</p>
          </section>
          <section className="policy-card">
            <h2>Your choices</h2>
            <p>You remain in control of your information. From within the app you can replace or remove your CV on the Job Scout page, unlink your WhatsApp number from Settings, and revoke Gmail access from the Connect Gmail page.</p>
            <p>You can also request access to, correction of, or deletion of your information by contacting us at the address below.</p>
          </section>
          <section className="policy-card">
            <h2>Children</h2>
            <p>Genaie is intended for adult job seekers and is not directed to children under 13. If you believe a child has provided information to the service, please contact us so it can be removed.</p>
          </section>
          <section className="policy-card">
            <h2>Changes and contact</h2>
            <p>This policy may be updated from time to time. When it changes, the "Last updated" date at the top of this page will be revised.</p>
            <p>If you have questions about this policy or your information, contact us at <a href="mailto:munemojoseph332@gmail.com">munemojoseph332@gmail.com</a>.</p>
          </section>
        </div>
      </main>
    </>
  );
}
