import fs from "node:fs";
import path from "node:path";
import { config } from "@/src/config";

export const runtime = "nodejs";

export default function OnboardingPage() {
  const htmlPath = path.join(process.cwd(), "public", "onboarding", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replaceAll("https://your-passbolt-domain.example", config.passboltPublicUrl.replace(/"/g, "&quot;"));

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
