import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // All route handlers that use Firebase Admin or Node crypto need the Node runtime
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
