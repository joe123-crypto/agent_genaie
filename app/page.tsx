import type { Metadata } from "next";
import { pageMetadata } from "@/src/lib/site-metadata";
import Image from "next/image";
import { Pricing } from "@/app/_components/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Genaie | Your AI job scout",
  description:
    "Genaie searches and applies for jobs on your behalf, then reports every application straight to your WhatsApp.",
  path: "/",
});

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

const socialLinks = [
  {
    label: "Genaie on Facebook",
    href: "https://www.facebook.com/share/1E5NjcoGSd/",
    icon: <FacebookIcon />,
  },
  {
    label: "Genaie on X",
    href: "https://x.com/joseph_mun4335",
    icon: <XIcon />,
  },
  {
    label: "Genaie on WhatsApp",
    href: "https://wa.me/213563719936",
    icon: <WhatsAppIcon />,
  },
  {
    label: "Email Genaie",
    href: "mailto:genaie2027@gmail.com",
    icon: <MailIcon />,
  },
];

function SocialLinks() {
  return (
    <ul className="landing-socials" aria-label="Social channels">
      {socialLinks.map((item) => (
        <li key={item.label}>
          <a
            className="landing-social-icon"
            href={item.href}
            aria-label={item.label}
            {...(item.href.startsWith("http")
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {item.icon}
          </a>
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
  {
    name: "Wequakavenda Jnr",
    handle: "wequakavenda.jnr",
    platform: "Instagram",
    href: "https://www.instagram.com/wequakavenda.jnr",
    avatar: "/users/wequakavenda_jnr.jpg",
  },
];

function TrustedBy() {
  return (
    <section className="landing-trusted" aria-label="Trusted by our users">
      <p className="landing-trusted-label">Trusted by</p>
      <ul className="landing-trusted-row">
        {featuredUsers.map((user) => (
          <li key={user.href} className="landing-trusted-item">
            <a
              className="landing-trusted-avatar"
              href={user.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${user.name} (@${user.handle}) on ${user.platform}`}
            >
              <Image src={user.avatar} alt={user.name} width={56} height={56} />
            </a>
            <span className="landing-trusted-handle">@{user.handle}</span>
            <span className="landing-trusted-platform">{user.platform}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HowTo() {
  return (
    <section className="landing-howto" aria-label="How it works">
      <h2 className="landing-howto-heading">See it in action</h2>
      <p className="landing-howto-subheading">
        Watch how Job Scout hunts for jobs while you live your life.
      </p>
      <div className="landing-howto-video-card">
        <iframe
          className="landing-howto-iframe"
          src="https://www.youtube.com/embed/AMbvDlGnfXs"
          title="Job Scout demo video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </section>
  );
}

const cvSamples = [
  "/7a890481f27260c16fc41ad63d221c55.jpg",
  "/a6ef6ca80af1c7567b46ac46a56a1628.jpg",
  "/c23d5690603b2937ed866d7124f27f61.jpg",
  "/e4febe023891b435edc20eb047cfcf28.jpg",
  "/eb2cfcda29436d3a939f57fff8762f09.jpg",
];

function CvPromo() {
  return (
    <section className="landing-cvpromo" aria-label="Create a CV">
      <h2 className="landing-cvpromo-heading">Don&apos;t have a CV?</h2>
      <p className="landing-cvpromo-subheading">
        Don&apos;t worry, you can create one in seconds.
      </p>
      <a className="button landing-cta" href="/login?next=/create-cv/interview">
        Create your CV
      </a>
      <div className="landing-cvpromo-marquee" aria-hidden="true">
        <div className="landing-cvpromo-track">
          {[...cvSamples, ...cvSamples].map((src, index) => (
            <div className="landing-cvpromo-card" key={`${src}-${index}`}>
              <Image
                src={src}
                alt="Sample CV"
                width={260}
                height={360}
                sizes="260px"
              />
            </div>
          ))}
        </div>
      </div>
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
      {
        label: "Facebook · Genaie",
        href: "https://www.facebook.com/share/1E5NjcoGSd/",
      },
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
          <Image
            id="landing-footer-title"
            className="landing-footer-logo"
            src="/logo-white.png"
            alt="Genaie"
            width={1045}
            height={283}
          />
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
          © 2026 Genaie. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default function RootPage() {
  return (
    <main className="landing-page">
      <div className="landing-canvas" id="home">
        <header className="landing-header">
          <a className="landing-brand" href="#home" aria-label="Genaie home">
            <Image
              src="/logo.png"
              alt="Genaie"
              width={1045}
              height={283}
              priority
            />
          </a>

          <nav className="landing-nav" aria-label="Primary navigation">
            <a className="is-active" href="#home" aria-current="page">
              Home
            </a>
            <a href="/about">About</a>
            <a href="#pricing">Pricing</a>
          </nav>

          <SocialLinks />
        </header>

        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy" id="about">
            <h1 id="landing-title">
              Applying for a job shouldn&apos;t be a full-time job.
            </h1>
            <p>
              Upload your CV and tell Genaie what you&apos;re looking for. Your
              personal agent finds matching jobs, applies on your behalf, and
              sends updates to WhatsApp.
            </p>
            <a className="button landing-cta" href="/login">
              Get started
            </a>
          </div>

          <div className="landing-visual">
            <Image
              className="landing-robot"
              src="/hero-robot.png"
              alt="Robot holding an envelope of documents and a suitcase in front of a city skyline"
              width={1024}
              height={1536}
              priority
              sizes="(max-width: 900px) 80vw, 32vw"
            />
          </div>
        </section>

        <TrustedBy />
        <HowTo />
        <CvPromo />
        <Pricing />
        <LandingFooter />
      </div>
    </main>
  );
}
