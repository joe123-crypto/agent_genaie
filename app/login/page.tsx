"use client";

import { Suspense } from "react";
import { StatusNotice } from "@/app/_components/status-ui";
import { LoginContent } from "@/app/login/login-content";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="app-main app-main-center"><StatusNotice kind="loading" variant="block">Loading...</StatusNotice></main>}>
      <LoginContent />
    </Suspense>
  );
}
