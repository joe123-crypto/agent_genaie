import type { Metadata } from "next";
import localFont from "next/font/local";
import {Analytics} from "@vercel/analytics/next";
import { SITE_IMAGE, SITE_NAME, SITE_URL } from "@/src/lib/site-metadata";
import "./globals.css";

const ubuntu = localFont({
  src: "./fonts/Ubuntu-Variable.ttf",
  weight: "100 800",
  display: "swap",
});

const description =
  "Genaie dashboard. Manage your Job Scout profile, CV, Gmail, and WhatsApp links.";

export const metadata: Metadata = {
  // Makes every metadata URL absolute, including the og:image below. Without
  // it WhatsApp receives a relative image URL, fails to resolve it, and
  // renders a text-only preview.
  metadataBase: SITE_URL,
  title: SITE_NAME,
  description,
  openGraph: {
    title: SITE_NAME,
    description,
    url: SITE_URL.toString(),
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    images: [SITE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description,
    images: [SITE_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={ubuntu.className}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
