import { test } from "node:test";
import assert from "node:assert/strict";

import { putObject, getPresignedGetUrl, objectExists, deleteObject } from "@/src/domains/r2-storage";
import { cvPendingObjectKey } from "@/src/domains/job-scout";

// Live round-trip against an S3-compatible server (MinIO in CI) using the app's
// own r2-storage functions, so the real client wiring and pending CV key
// layout are exercised end-to-end. Skips when R2_ENDPOINT isn't configured so
// `npm test` never reaches for a real bucket.
const skip = !process.env.R2_ENDPOINT;
const opts = { skip: skip && "R2_ENDPOINT not set" };

test("CV object round-trips: put -> exists -> presigned GET -> delete", opts, async () => {
  const key = cvPendingObjectKey(`ci-uid-${Date.now()}`);
  assert.match(key, /\/cv\/pending\/original\.pdf$/); // layout guard

  const body = Buffer.from("%PDF-1.4\nintegration-test\n");
  await putObject(key, body, "application/pdf");

  assert.equal(await objectExists(key), true);

  const url = await getPresignedGetUrl(key, 300);
  assert.match(url, /X-Amz-Signature=/);
  assert.ok(url.includes(encodeURIComponent(key)) || url.includes(key), "URL references the object key");

  const res = await fetch(url);
  assert.equal(res.status, 200);
  const fetched = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(fetched, body);

  await deleteObject(key);
  assert.equal(await objectExists(key), false);
});

test("objectExists returns false for a missing key (404 branch)", opts, async () => {
  assert.equal(await objectExists(`ci-missing-${Date.now()}/cv/cv.pdf`), false);
});
