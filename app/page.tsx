import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Genaie Scout | Your AI task agent",
  description:
    "Let Genaie Scout handle repetitive work so you can focus on what matters.",
};

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill="currentColor" />
      <path
        d="M13.4 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.2 1.2-1.2h1.3V5.8c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.7V13h2.1v6h2.6Z"
        fill="#fff"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 4.5h3.8l3.9 5.2 4.5-5.2h1.7l-5.4 6.3L19.8 19H16l-4.3-5.7L6.8 19H5.1l5.8-6.8L5 4.5Zm3 1.4 8.8 11.7h1L9 5.9H8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.4 11.7a8.4 8.4 0 0 1-12.5 7.4L3.5 20l.9-4.2A8.4 8.4 0 1 1 20.4 11.7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 7.8c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .5.4l.7 1.7c.1.3.1.5-.1.7l-.6.7c-.2.2-.1.4 0 .6.7 1.3 1.8 2.4 3.2 3 .3.1.5.2.7-.1l.8-1c.2-.2.4-.3.7-.2l1.8.8c.3.1.4.3.4.5 0 .3-.2 1.5-1 2.1-.7.6-1.6.8-2.2.7-.6-.1-3.1-1-5.2-2.9-1.7-1.6-2.8-3.5-3.1-4.1-.2-.6 0-1.8.4-2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="3"
        y="5.5"
        width="18"
        height="13"
        rx=".5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m4 7 8 6 8-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SocialPlaceholders() {
  const items = [
    { label: "Facebook link coming soon", icon: <FacebookIcon /> },
    { label: "X link coming soon", icon: <XIcon /> },
    { label: "WhatsApp link coming soon", icon: <WhatsAppIcon /> },
    { label: "Email link coming soon", icon: <MailIcon /> },
  ];

  return (
    <ul className="landing-socials" aria-label="Social channels">
      {items.map((item) => (
        <li key={item.label}>
          <span className="landing-social-icon" aria-label={item.label} role="img">
            {item.icon}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DecorativeScene() {
  return (
    <svg
      className="landing-scene"
      viewBox="0 0 680 590"
      fill="none"
      aria-hidden="true"
    >
      <g className="landing-scene-horizon">
        <path className="landing-line" pathLength="1" d="M284 270H641" />
        <path className="landing-line landing-sun" pathLength="1" d="M494 269a47 47 0 1 1 94 0" />
        <path className="landing-line landing-delay-1" pathLength="1" d="M470 292h73M454 304h105M443 316h130" />
        <path className="landing-line landing-delay-2" pathLength="1" d="M463 328h8m14 0h16m17 0h9m17 0h14" />
      </g>

      <g className="landing-scene-platform">
        <path className="landing-line" pathLength="1" d="M66 375h280v142h113v67" />
        <path className="landing-line landing-dashed" pathLength="1" d="M459 584h180" />
      </g>

      <g className="landing-scene-flow">
        <path
          className="landing-line landing-delay-1"
          pathLength="1"
          d="M316 454c28-34 58-35 95-16 37 19 83 25 128-9 24-18 47-42 66-71"
        />
        <path
          className="landing-line landing-dashed landing-delay-2"
          pathLength="1"
          d="M492 478c50-7 91-32 122-78"
        />
        <circle className="landing-dot landing-dot-a" cx="438" cy="398" r="11" />
        <circle className="landing-dot landing-dot-b" cx="476" cy="468" r="5" />
        <circle className="landing-dot landing-dot-c" cx="567" cy="399" r="3.5" />
      </g>
    </svg>
  );
}

export default function RootPage() {
  return (
    <main className="landing-page">
      <div className="landing-canvas" id="home">
        <header className="landing-header">
          <a className="landing-brand" href="#home" aria-label="Genaie Scout home">
            Genaie Scout
          </a>

          <nav className="landing-nav" aria-label="Primary navigation">
            <a className="is-active" href="#home" aria-current="page">
              Home
            </a>
            <a href="#about">About</a>
            <a href="/privacy-policy">Privacy &amp; Policy</a>
          </nav>

          <SocialPlaceholders />
        </header>

        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy" id="about">
            <h1 id="landing-title">
              Let an agent do the boring repetitive work for you
            </h1>
            <p>
              Focus on what matters. Genaie Scout is your AI agent that handles
              the boring tasks so you can achieve more, stress less.
            </p>
            <a className="button landing-cta" href="/login">
              Get Started
            </a>
          </div>

          <div className="landing-visual">
            <DecorativeScene />
            <Image
              className="landing-robot"
              src="/Pasted image (3).png"
              alt="Robot assistant holding documents and a suitcase"
              width={1536}
              height={1024}
              priority
              sizes="(max-width: 900px) 88vw, 48vw"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
