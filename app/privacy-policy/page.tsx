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
            <p>This page explains how Genaie uses Webetu credentials, Gmail, and Calendar permissions.</p>
            <div className="actions actions-spaced">
              {dashboardHref ? (
                <a className="button" href={dashboardHref}>Back to dashboard</a>
              ) : (
                <a className="button" href="/login">Sign in</a>
              )}
            </div>
          </header>
          <section className="policy-card">
            <h2>Webetu Credentials</h2>
            <p>Your Webetu username and password are used only to sign in to Webetu for the meal reservation service.</p>
            <p>They are encrypted before storage. The application is designed so secret credentials are not shown to the agent or developers in the user interface, logs, or API responses.</p>
            <p>If you no longer need the service, or if you no longer trust the service, you can remove your saved credentials from the Credentials Vault. You are encouraged to remove credentials that you no longer need.</p>
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
