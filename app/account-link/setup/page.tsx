import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus } from "@/src/domains/users";
import { getAccountLinkInvite } from "@/src/domains/account-link";
import { maskPhone, escapeHtml, escapeHtmlAttribute } from "@/src/lib/utils";

export const runtime = "nodejs";

function normalizeAccountLinkPurpose(purpose: string) {
  const text = String(purpose ?? "").toLowerCase().trim();
  return text || "account";
}

function purposeLabel(purpose: string) {
  const normalized = normalizeAccountLinkPurpose(purpose);
  if (normalized === "webetu") return "Webetu meal reservations";
  if (normalized === "jobs") return "Job Scout";
  if (normalized === "news") return "Personalized news";
  if (normalized === "account") return "Account link";
  return normalized.replace(/[_-]+/g, " ");
}

export default async function AccountLinkSetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  const setupPath = `/account-link/setup?token=${encodeURIComponent(token ?? "")}`;
  const confirmPath = `/account-link/setup/confirm?token=${encodeURIComponent(token ?? "")}`;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(setupPath)}`);

  let uid: string;
  let email: string | null = null;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
    email = user.email ?? null;
  } catch {
    redirect(`/login?next=${encodeURIComponent(setupPath)}`);
  }

  await syncUserToCentralData(uid!);
  const centralUser = await getSignedInAccountStatus(uid!).catch(() => null);
  email = centralUser?.profile?.email ?? email;

  const invite = await getAccountLinkInvite(token ?? "");
  const maskedPhone = maskPhone(invite.phone);
  const purpose = normalizeAccountLinkPurpose(invite.purpose ?? "");

  const switchScript = `
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const switchButton = document.querySelector("[data-switch-account]");

async function signOutFirebase() {
  const response = await fetch("/config/firebase");
  const settings = await response.json().catch(function() { return {}; });
  if (!settings.configured) return;
  const app = initializeApp(settings.firebase);
  await signOut(getAuth(app));
}

if (switchButton) {
  switchButton.addEventListener("click", async function() {
    switchButton.disabled = true;
    try {
      await fetch("/auth/session/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: "{}"
      });
    } catch {}
    try { await signOutFirebase(); } catch {}
    window.location.assign(${JSON.stringify(`/login?next=${encodeURIComponent(setupPath)}`)});
  });
}
`;

  return (
    <>
      <main className="app-main app-main-center">
        <section className="panel panel-narrow">
          <a className="toplink" href="/">Back to app</a>
          <h1>Confirm account link</h1>
          <p>Confirm before linking this WhatsApp chat to the signed-in app account.</p>
          <div className="meta">
            <div><strong>Signed-in email:</strong> {email ?? "Unknown email"}</div>
            <div><strong>WhatsApp:</strong> {maskedPhone}</div>
            <div><strong>Purpose:</strong> {purposeLabel(purpose)}</div>
          </div>
          <div className="actions actions-spaced">
            <form method="post" action={confirmPath}>
              <button type="submit">Confirm and link</button>
            </form>
            <button className="secondary" data-switch-account type="button">Use a different Google account</button>
            <a className="button secondary" href="/">Cancel</a>
          </div>
        </section>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: switchScript }} />
    </>
  );
}
