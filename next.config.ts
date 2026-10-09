import type { NextConfig } from "next";

// The CV maker moved to its own app (genaie-cv). Old links into it (bookmarks,
// sent WhatsApp messages, payment-proof review emails) are forwarded there.
const cvAppUrl = process.env.NEXT_PUBLIC_CV_APP_URL?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // All route handlers that use Firebase Admin or Node crypto need the Node runtime
  serverExternalPackages: ["firebase-admin"],
  async redirects() {
    if (!cvAppUrl) return [];
    const scopedUser = ":publicUserId(usr_[A-Za-z0-9_-]{16})";
    return [
      { source: "/create-cv/:path*", destination: `${cvAppUrl}/create-cv/:path*`, permanent: false },
      { source: "/payment/:path*", destination: `${cvAppUrl}/payment/:path*`, permanent: false },
      { source: `/${scopedUser}/create-cv/:path*`, destination: `${cvAppUrl}/:publicUserId/create-cv/:path*`, permanent: false },
      { source: `/${scopedUser}/download-cv/:path*`, destination: `${cvAppUrl}/:publicUserId/download-cv/:path*`, permanent: false },
    ];
  },
  async rewrites() {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    if (!projectId) return [];
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
