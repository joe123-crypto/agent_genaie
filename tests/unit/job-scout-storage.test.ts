import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationArtifactObjectKey,
  cvHtmlObjectKey,
  cvPendingObjectKey,
  validateCanonicalCvHtml,
} from "@/src/domains/job-scout";

test("CV keys use per-user pending and canonical folders", () => {
  assert.equal(cvPendingObjectKey("uid-1"), "uid-1/cv/pending/original.pdf");
  assert.equal(cvHtmlObjectKey("uid-1"), "uid-1/cv/base/cv.html");
  assert.throws(() => cvHtmlObjectKey("../other-user"));
});

test("canonical CV HTML accepts styled documents and rejects executable content", () => {
  const safe = Buffer.from("<!doctype html><html><head><style>body{font:12px sans-serif}</style></head><body><main>CV</main></body></html>");
  assert.match(validateCanonicalCvHtml(safe), /<main>CV<\/main>/);
  assert.throws(() => validateCanonicalCvHtml(Buffer.from("<html><body><script>alert(1)</script></body></html>")));
  assert.throws(() => validateCanonicalCvHtml(Buffer.from("<html><body><a href=\"javascript:alert(1)\">x</a></body></html>")));
  assert.throws(() => validateCanonicalCvHtml(Buffer.from("<p>fragment only</p>")));
});

test("application artifact keys map allowed kinds to fixed filenames", () => {
  const base = { userId: "uid-1", applicationId: "abc_123", attempt: 2 };
  assert.equal(
    applicationArtifactObjectKey({ ...base, kind: "cv" }),
    "uid-1/applications/abc_123/2/cv.pdf",
  );
  assert.equal(
    applicationArtifactObjectKey({ ...base, kind: "cover_letter_text" }),
    "uid-1/applications/abc_123/2/cover-letter.txt",
  );
  assert.equal(
    applicationArtifactObjectKey({ ...base, kind: "cover_letter_pdf" }),
    "uid-1/applications/abc_123/2/cover-letter.pdf",
  );
  assert.throws(() => applicationArtifactObjectKey({ ...base, attempt: 0, kind: "cv" }));
  assert.throws(() => applicationArtifactObjectKey({ ...base, applicationId: "../other", kind: "cv" }));
});
