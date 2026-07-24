import Image from "next/image";
import Link from "next/link";

const notFoundArtworkSrc =
  "/ChatGPT%20Image%20Jul%2024%2C%202026%2C%2002_59_29%20AM.png";

export default function NotFound() {
  return (
    <main className="not-found-page" aria-labelledby="not-found-title">
      <div className="not-found-shell">
        <div className="not-found-artwork">
          <Image
            src={notFoundArtworkSrc}
            alt="Personalized 404 illustration"
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 720px) 82vw, 360px"
          />
        </div>

        <section className="not-found-copy">
          <h1 id="not-found-title">404</h1>
          <p className="not-found-kicker">Something&apos;s missing.</p>
          <p className="not-found-message">
            This page is missing or you assembled the link incorrectly.
          </p>
          <Link className="not-found-link" href="/">
            Go Home
            <span aria-hidden="true">›</span>
          </Link>
        </section>
      </div>
    </main>
  );
}
