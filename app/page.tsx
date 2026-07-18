import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Genaie Scout | Your AI job scout",
  description:
    "Genaie Scout searches and applies for jobs on your behalf, then reports every application straight to your WhatsApp.",
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

type FeaturedUser = {
  name: string;
  handle: string;
  platform: "X" | "Instagram" | "Facebook";
  href: string;
  avatar: string;
};

const featuredUsers: FeaturedUser[] = [
  {
    name: "Joseph Mun",
    handle: "joseph_mun4335",
    platform: "X",
    href: "https://x.com/joseph_mun4335",
    avatar: "/users/joseph_mun4335.jpg",
  },
];

function TrustedBy() {
  return (
    <section className="landing-trusted" aria-label="Trusted by our users">
      <p className="landing-trusted-label">Trusted by</p>
      <ul className="landing-trusted-row">
        {featuredUsers.map((user) => (
          <li key={user.href}>
            <a
              className="landing-trusted-avatar"
              href={user.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${user.name} (@${user.handle}) on ${user.platform}`}
            >
              <Image src={user.avatar} alt={user.name} width={56} height={56} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const footerColumns = [
  {
    title: "Navigation",
    links: [
      { label: "Home", href: "#home" },
      { label: "About", href: "#about" },
      { label: "Start your job hunt", href: "/login" },
    ],
  },
  {
    title: "App",
    links: [
      { label: "Dashboard", href: "/vault" },
      { label: "CV vault", href: "/vault" },
      { label: "Connect Gmail", href: "/connect-gmail" },
      { label: "WhatsApp setup", href: "/whatsapp" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy-policy" },
      { label: "Terms of service", href: "/terms-of-service" },
    ],
  },
  {
    title: "Social media",
    links: [
      {
        label: "X / Twitter · @joseph_mun4335",
        href: "https://x.com/joseph_mun4335",
      },
      { label: "Facebook · coming soon", href: "#home" },
      { label: "WhatsApp · +213 563 719 936", href: "https://wa.me/213563719936" },
      { label: "Email · genaie2027@gmail.com", href: "mailto:genaie2027@gmail.com" },
    ],
  },
];

function LandingFooter() {
  return (
    <footer className="landing-footer" aria-labelledby="landing-footer-title">
      <div className="landing-footer-grid">
        <div className="landing-footer-brand-column">
          <p id="landing-footer-title" className="landing-footer-eyebrow">
            Genaie Scout
          </p>
          <p className="landing-footer-summary">
            An AI job scout that finds roles, applies with your CV, and reports
            every application back to your WhatsApp.
          </p>
        </div>

        {footerColumns.map((column) => (
          <nav
            className="landing-footer-column"
            key={column.title}
            aria-label={`${column.title} footer links`}
          >
            <h2>{column.title}</h2>
            <ul>
              {column.links.map((link) => (
                <li key={`${column.title}-${link.label}`}>
                  <a
                    href={link.href}
                    aria-label={
                      link.label === "Start your job hunt"
                        ? "Footer sign-in link"
                        : `${link.label} footer link`
                    }
                    {...(link.href.startsWith("http")
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="landing-footer-bottom">
        <p>
          Built by{" "}
          <a
            className="landing-footer-maker"
            href="https://x.com/joseph_mun4335"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              src="/users/joseph_mun4335.jpg"
              alt=""
              width={24}
              height={24}
              aria-hidden="true"
            />
            Joseph Mun
          </a>
        </p>
        <p className="landing-footer-copyright">
          © 2026 Genaie Scout. All rights reserved.
        </p>
      </div>
    </footer>
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
            <a href="/terms-of-service">Terms of Service</a>
          </nav>

          <SocialPlaceholders />
        </header>

        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy" id="about">
            <h1 id="landing-title">
              Your AI agent that hunts for jobs while you live your life
            </h1>
            <p>
              Upload your CV and tell Genaie Scout the role you want. Your
              agent searches openings, applies on your behalf, and reports
              every application straight to your WhatsApp.
            </p>
            <a className="button landing-cta" href="/login">
              Start your job hunt
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

        <TrustedBy />
        <LandingFooter />
      </div>
    </main>
  );
}
