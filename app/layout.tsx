import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Genaie",
  description: "Genaie service dashboard – manage Gmail, Webetu credentials, and account links.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
