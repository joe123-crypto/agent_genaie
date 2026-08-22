import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // All route handlers that use Firebase Admin or Node crypto need the Node runtime
  serverExternalPackages: ["firebase-admin", "@sparticuz/chromium", "puppeteer-core"],
  // @sparticuz/chromium resolves its Chromium binary at runtime from `<pkg>/bin`
  // (see its paths.js), a path Next's static file tracer cannot follow. Without
  // this the ~64MB bin/*.br files are left out of the deployed function and
  // chromium.executablePath() throws "The input directory does not exist", so
  // every CV PDF download fails in production while working fine locally.
  outputFileTracingIncludes: {
    "/[publicUserId]/download-cv/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
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
