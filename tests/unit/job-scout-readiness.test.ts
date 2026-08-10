import assert from "node:assert/strict";
import test from "node:test";
import { evaluateJobScoutReadiness } from "@/src/domains/job-scout-readiness";

const complete = {
  gmailConnected: true,
  senderEmail: "applicant@example.com",
  cvFileRef: "uid/cv/base/cv.html",
  cvHtmlRef: "uid/cv/base/cv.html",
  cvConversionStatus: "ready",
  cvAvailable: true,
  preferences: {
    targetRoles: ["Waitress"],
    locations: ["Harare, Zimbabwe"],
    country: "zw",
  },
};

test("grandfathers structurally complete legacy profiles", () => {
  const result = evaluateJobScoutReadiness(complete);
  assert.equal(result.legacyProfile, true);
  assert.equal(result.profileConfirmed, true);
  assert.equal(result.safetyAcknowledged, true);
  assert.equal(result.ready, true);
});

test("keeps incomplete legacy profiles in draft", () => {
  const result = evaluateJobScoutReadiness({
    ...complete,
    preferences: { targetRoles: [], locations: [], country: "dz" },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.missingRequirements,
    ["target_roles", "locations", "profile_confirmation", "safety_acknowledgement"],
  );
});

test("requires persisted confirmation and safety acknowledgement for version 2", () => {
  const draft = evaluateJobScoutReadiness({ ...complete, onboardingVersion: 2 });
  assert.equal(draft.ready, false);
  assert.deepEqual(draft.missingRequirements, ["profile_confirmation", "safety_acknowledgement"]);

  const ready = evaluateJobScoutReadiness({
    ...complete,
    onboardingVersion: 2,
    profileConfirmedAt: new Date(),
    safetyAcknowledgedAt: new Date(),
  });
  assert.equal(ready.ready, true);
});

test("rejects missing or revoked Gmail readiness", () => {
  const result = evaluateJobScoutReadiness({ ...complete, gmailConnected: false });
  assert.equal(result.ready, false);
  assert.ok(result.missingRequirements.includes("gmail_connection"));
});

test("treats a missing CV as optional for readiness", () => {
  const result = evaluateJobScoutReadiness({
    ...complete,
    cvFileRef: null,
    cvHtmlRef: null,
    cvConversionStatus: "missing",
    cvAvailable: false,
  });
  assert.equal(result.ready, true);
  assert.ok(!result.missingRequirements.includes("cv"));
  assert.ok(!result.missingRequirements.includes("cv_conversion"));
});

test("pauses readiness while a PDF awaits HTML conversion", () => {
  const result = evaluateJobScoutReadiness({
    ...complete,
    cvFileRef: null,
    cvHtmlRef: null,
    cvConversionStatus: "pending",
    cvAvailable: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.setupStatus, "pending");
  assert.ok(result.missingRequirements.includes("cv_conversion"));
  assert.ok(!result.missingRequirements.includes("cv"));
});

test("does not grandfather legacy PDF-only profiles", () => {
  const result = evaluateJobScoutReadiness({
    ...complete,
    cvFileRef: "uid/cv/cv.pdf",
    cvHtmlRef: null,
    cvConversionStatus: "pending",
    cvAvailable: true,
  });
  assert.equal(result.legacyProfile, true);
  assert.equal(result.ready, false);
  assert.ok(result.missingRequirements.includes("cv_conversion"));
});

test("treats WhatsApp linking as optional, never a readiness requirement", () => {
  const result = evaluateJobScoutReadiness({
    ...complete,
    onboardingVersion: 2,
    profileConfirmedAt: new Date(),
    safetyAcknowledgedAt: new Date(),
  });
  assert.equal(result.ready, true);
  assert.ok(!result.missingRequirements.includes("phone_link"));
});
