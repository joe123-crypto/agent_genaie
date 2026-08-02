import type { Metadata } from "next";
import { pageMetadata } from "@/src/lib/site-metadata";
import { Suspense } from "react";

export const metadata: Metadata = pageMetadata({
  title: "Genaie | Login",
  description:
    "Sign in to your Genaie account to manage your AI-powered job applications.",
  path: "/login",
});
import { StatusNotice } from "@/app/_components/status-ui";
import { LoginContent } from "@/app/login/login-content";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="app-main app-main-center"><StatusNotice kind="loading" variant="block">Loading...</StatusNotice></main>}>
      <LoginContent />
    </Suspense>
  );
}
