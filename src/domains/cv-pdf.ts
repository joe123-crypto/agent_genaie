import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";
import { httpError } from "@/src/lib/utils";

// Injectable so unit tests can supply a fake/throwing launcher without a real
// browser. Production uses @sparticuz/chromium on Vercel and installed Chrome locally.
export type BrowserLauncher = () => Promise<Browser>;

async function launchBrowser(): Promise<Browser> {
  // Only Vercel gets the bundled serverless Chromium. Keying this off NODE_ENV
  // too would break `next build && next start` on a dev machine and any
  // self-hosted deploy, since that binary only runs on Amazon-Linux-like hosts.
  if (process.env.VERCEL) {
    // A CV is text on a white page — no WebGL. Disabling the graphics stack skips
    // inflating swiftshader.tar.br (~3.5MB) on every cold start.
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // Local dev: use an installed Chrome/Chromium.
  return puppeteer.launch({ channel: "chrome", headless: true });
}

// Render self-contained CV HTML (inline CSS, system fonts, no JS, no network) to
// an A4 PDF. `preferCSSPageSize` honors the template's `@page { size: A4; margin: 18mm }`.
export async function renderCvHtmlToPdf(
  html: string,
  launch: BrowserLauncher = launchBrowser,
): Promise<Buffer> {
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } catch (err) {
    // Preserve the underlying Chromium/launch error for diagnostics; the route
    // only ever sees the flattened 502, so this is the one place it's captured.
    console.error("CV PDF render failed", err);
    throw httpError(502, "CV PDF renderer is unavailable.");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
