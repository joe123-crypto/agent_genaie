import assert from "node:assert/strict";
import test from "node:test";
import { evaluateJobScoutReadiness } from "./job-scout-readiness";

const complete = {
  linked: true,
  gmailConnected: true,
  senderEmail: "applicant@example.com",
  cvFileRef: "uid/cv/cv.pdf",
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

test("requires the CV object, not only its reference", () => {
  const result = evaluateJobScoutReadiness({ ...complete, cvAvailable: false });
  assert.equal(result.ready, false);
  assert.ok(result.missingRequirements.includes("cv"));
});
