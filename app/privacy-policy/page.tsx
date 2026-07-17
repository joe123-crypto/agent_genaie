import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/src/config";
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
            <p>This page explains how Genaie Scout uses your CV, Gmail and Calendar permissions, and WhatsApp connection.</p>
            <div className="actions actions-spaced">
              {dashboardHref ? (
                <a className="button" href={dashboardHref}>Back to dashboard</a>
              ) : (
                <a className="button" href="/login">Sign in</a>
              )}
            </div>
          </header>
          <section className="policy-card">
            <h2>Your CV and Job Profile</h2>
            <p>Your CV and job preferences (such as target role and location) are used only to search for openings and prepare job applications on your behalf.</p>
            <p>Your CV is stored securely and is not shared beyond the applications the agent submits for you. You can replace or remove it at any time from the Job Scout page.</p>
          </section>
          <section className="policy-card">
            <h2>WhatsApp</h2>
            <p>Your linked WhatsApp number is used only to deliver job search results, application reports, and setup reminders. It is shown masked in the interface, and you can unlink it at any time from Settings.</p>
          </section>
          <section className="policy-card">
            <h2>Google Permissions</h2>
            <p>Gmail and Calendar access are granted together as a single Google connection. Connecting grants both permissions, and revoking removes both at once.</p>
            <h3>Gmail</h3>
            <p>The Gmail permission requested by this application is send-only. It allows the application to send emails on your behalf so it can complete job applications.</p>
            <p>This permission is not used to read your emails. It is not used for anything other than sending job application emails for services you have enabled.</p>
            <h3>Calendar</h3>
            <p>The Calendar permission allows the application to create calendar events on your behalf, so it can add reminders and scheduled items for services you have enabled.</p>
            <p>This permission is used only to add and manage events the application creates. It is not used to read or share your existing calendar entries.</p>
            <h3>Revoking access</h3>
            <p>You can revoke Google access at any time from the Connect Google page, which removes both the Gmail and Calendar permissions together. You are encouraged to revoke permissions that you no longer need.</p>
          </section>
        </div>
      </main>
    </>
  );
}
