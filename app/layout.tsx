import type { Metadata } from "next";
import localFont from "next/font/local";
import {Analytics} from "@vercel/analytics/next";
import "./globals.css";

const ubuntu = localFont({
  src: "./fonts/Ubuntu-Variable.ttf",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agent Genaie",
  description: "Genaie service dashboard. Manage Gmail, Webetu credentials, Job Scout, and WhatsApp links.",
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
