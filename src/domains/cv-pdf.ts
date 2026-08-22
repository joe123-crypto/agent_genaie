import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";
import { httpError } from "@/src/lib/utils";

// Injectable so unit tests can supply a fake/throwing launcher without a real
// browser. Production uses @sparticuz/chromium on Vercel and installed Chrome locally.
export type BrowserLauncher = () => Promise<Browser>;

async function launchBrowser(): Promise<Browser> {
  const serverless = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
  if (serverless) {
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
