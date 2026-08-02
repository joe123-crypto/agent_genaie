import type { Metadata } from "next";
import { pageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = pageMetadata({
  title: "Genaie | We are what we do",
  description:
    "Why Genaie exists: to let people spend less time on repetitive job applications and more time on meaningful work.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className="app-main policy-page">
      <div className="shell">
        <header className="policy-card">
          <h1>We are what we do</h1>
          <p>
            The developer of this application strongly believes that time is one
            of the most valuable things we have. It should be spent pursuing our
            passions, improving our skills, acquiring knowledge, starting or
            running businesses, and living life fully while we can.
          </p>
          <p>
            Repetitive, mundane work like applying for jobs can take hours from
            the work and growth that matter most. That is why he built Genaie
            Scout: first for himself, then for close friends and family, so AI
            could handle the job-application work nobody wants to do.
          </p>
          <div className="actions actions-spaced">
            <a className="button" href="/login">
              Start your job hunt
            </a>
            <a className="button secondary" href="/">
              Back home
            </a>
          </div>
        </header>

        <section className="policy-card">
          <h2>Why it exists</h2>
          <p>
            Genaie exists to give people back attention, momentum, and
            time. The goal is not to avoid work. The goal is to move repetitive
            work to software, so people can focus on work that teaches them,
            challenges them, and moves their lives forward.
          </p>
          <p>
            After all, we are defined by what we immerse ourselves in. The work
            we do defines us more than anything.
          </p>
        </section>
      </div>
    </main>
  );
}
