import assert from "node:assert/strict";
import test from "node:test";

import type { Browser } from "puppeteer-core";

import { type BrowserLauncher, renderCvHtmlToPdf } from "@/src/domains/cv-pdf";

test("renderCvHtmlToPdf maps a launcher failure to 502", async () => {
  const failingLaunch: BrowserLauncher = async () => {
    throw new Error("no browser available");
  };
  await assert.rejects(
    renderCvHtmlToPdf("<html/>", failingLaunch),
    (err: { status?: number }) => err.status === 502,
  );
});

test("renderCvHtmlToPdf returns the PDF bytes and closes the browser on success", async () => {
  const html = "<html><body>ok</body></html>";
  let closed = false;
  let contentReceived: string | undefined;

  const fakePage = {
    async setContent(received: string) {
      contentReceived = received;
    },
    async pdf() {
      return Buffer.from("%PDF-1.7\nbody\n%%EOF");
    },
  };
  const fakeBrowser = {
    async newPage() {
      return fakePage;
    },
    async close() {
      closed = true;
    },
  };
  const launch: BrowserLauncher = async () => fakeBrowser as unknown as Browser;

  const pdf = await renderCvHtmlToPdf(html, launch);

  assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")), "buffer must start with %PDF-");
  assert.equal(contentReceived, html, "setContent must receive the passed html");
  assert.equal(closed, true, "browser must be closed after a successful render");
});

test("renderCvHtmlToPdf closes the browser and maps to 502 when newPage throws", async () => {
  let closed = false;
  const fakeBrowser = {
    async newPage(): Promise<never> {
      throw new Error("newPage exploded");
    },
    async close() {
      closed = true;
    },
  };
  const launch: BrowserLauncher = async () => fakeBrowser as unknown as Browser;

  await assert.rejects(
    renderCvHtmlToPdf("<html/>", launch),
    (err: { status?: number }) => err.status === 502,
  );
  assert.equal(closed, true, "browser must be closed even when newPage throws");
});
