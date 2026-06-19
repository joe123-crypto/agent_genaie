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
      <style dangerouslySetInnerHTML={{ __html: `
        :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--border:#d8dee7;--text:#15171a;--muted:#5f6875;--blue:#2f74d0}
        *{box-sizing:border-box}
        body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
        main{min-height:100vh;padding:28px}
        .shell{width:min(860px,100%);margin:0 auto;display:grid;gap:16px}
        header,section{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px;box-shadow:0 12px 32px rgba(22,28,36,.07)}
        h1,h2,h3{margin:0 0 10px;letter-spacing:0;line-height:1.2}
        h1{font-size:2rem}
        h2{font-size:1.18rem}
        h3{font-size:1rem;margin-top:18px}
        p{margin:0 0 12px;color:var(--muted);line-height:1.58}
        p:last-child{margin-bottom:0}
        a{color:var(--blue);font-weight:750;text-decoration:none}
        a:hover{text-decoration:underline}
        .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
        .button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;border-radius:7px;background:var(--blue);color:#fff;padding:0 14px;text-decoration:none}
        .button.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        @media (max-width:680px){main{padding:18px}header,section{padding:18px}}
      `}} />
      <main>
        <div className="shell">
          <header>
            <h1>Privacy &amp; Policy</h1>
            <p>This page explains how Genaie uses Webetu credentials, Gmail, and Calendar permissions.</p>
            <div className="actions">
              {dashboardHref ? (
                <a className="button" href={dashboardHref}>Back to dashboard</a>
              ) : (
                <a className="button" href="/login">Sign in</a>
              )}
            </div>
          </header>
          <section>
            <h2>Webetu Credentials</h2>
            <p>Your Webetu username and password are used only to sign in to Webetu for the meal reservation service.</p>
            <p>They are encrypted before storage. The application is designed so secret credentials are not shown to the agent or developers in the user interface, logs, or API responses.</p>
            <p>If you no longer need the service, or if you no longer trust the service, you can remove your saved credentials from the Credentials Vault. You are encouraged to remove credentials that you no longer need.</p>
          </section>
          <section>
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
