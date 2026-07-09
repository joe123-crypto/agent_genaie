import { test } from "node:test";
import assert from "node:assert/strict";

import { getFirestoreDb } from "@/src/firebase/admin";
import { credentialRefId, jobApplicationId, whatsappPhoneHash } from "@/src/lib/utils";
import { jobScoutTokenHash } from "@/src/security/crypto";
import {
  saveJobScoutProfile,
  createJobScoutInvite,
  getJobScoutInvite,
  recordJobApplication,
  listJobApplications,
  resetJobScoutProfileForPhone,
} from "@/src/domains/job-scout";

// Live round-trip against the Firestore emulator (started by CI via
// `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST). This proves the
// real admin SDK writes the document *structures* the rest of the system — and
// the genaebot worker — depends on. When there's no emulator, the suite skips so
// `npm test` never touches a real database.
const skip = !process.env.FIRESTORE_EMULATOR_HOST;
const opts = { skip: skip && "FIRESTORE_EMULATOR_HOST not set" };

test("saveJobScoutProfile writes the expected jobScoutProfiles document shape", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-profile-${Date.now()}`;
  const phone = "+263775780179";
  await Promise.all([
    db.collection("phoneLinksByUser").doc(uid).set({
      userId: uid,
      phone,
      phoneHash: whatsappPhoneHash(phone),
      status: "active",
    }),
    db.collection("users").doc(uid).set({
      profile: { email: "applicant@example.com", displayName: "Applicant" },
    }),
    db.collection("credentialRefs").doc(credentialRefId(uid, "gmail", "oauth2")).set({
      userId: uid,
      service: "gmail",
      purpose: "oauth2",
      status: "active",
    }),
  ]);
  await saveJobScoutProfile({
    userId: uid,
    preferences: {
      targetRoles: ["Dev", "dev"],
      locations: ["Paris, France"],
      maxApplicationsPerRun: 99,
      country: "FR",
    },
    cvFileRef: `${uid}/cv/cv.pdf`,
    cvParsedText: "x".repeat(60000),
    profileConfirmed: true,
    safetyAcknowledged: true,
  }, { objectExists: async () => true });

  const snap = await db.collection("jobScoutProfiles").doc(uid).get();
  assert.ok(snap.exists, "profile document should exist");
  const data = snap.data()!;
  assert.equal(data.userId, uid);
  assert.deepEqual(data.preferences.targetRoles, ["Dev"]); // deduped
  assert.equal(data.preferences.maxApplicationsPerRun, 5); // clamped
  assert.equal(data.preferences.country, "fr"); // normalized locale
  assert.equal(data.cvFileRef, `${uid}/cv/cv.pdf`);
  assert.equal(data.cvParsedText.length, 50000); // capped
  assert.equal(data.onboardingVersion, 2);
  assert.equal(data.setupStatus, "ready");
  assert.ok(data.profileConfirmedAt, "profile confirmation timestamp present");
  assert.ok(data.safetyAcknowledgedAt, "safety acknowledgement timestamp present");
  assert.ok(data.createdAt, "createdAt server timestamp present");
  assert.ok(data.updatedAt, "updatedAt server timestamp present");
});

test("createJobScoutInvite/getJobScoutInvite round-trips a pending invite", opts, async () => {
  const { token } = await createJobScoutInvite("+213600000001");
  const invite = await getJobScoutInvite(token);
  assert.equal(invite.status, "pending");
  assert.equal(invite.phone, "+213600000001");
  assert.match(invite.phoneHash, /^[0-9a-f]{12}$/);
  assert.equal(invite.tokenHash, jobScoutTokenHash(token));
  assert.ok(invite.expiresAt, "expiresAt present");
});

test("getJobScoutInvite rejects a tampered token", opts, async () => {
  const { token } = await createJobScoutInvite("+213600000002");
  await assert.rejects(() => getJobScoutInvite(`${token}tampered`));
});

test("getJobScoutInvite rejects an expired invite (410)", opts, async () => {
  const db = getFirestoreDb();
  const ref = db.collection("jobScoutInvites").doc();
  const token = ref.id;
  await ref.set({
    phone: "+213600000003",
    phoneHash: "abcabcabcabc",
    tokenHash: jobScoutTokenHash(token),
    status: "pending",
    expiresAt: new Date(Date.now() - 60_000), // already expired
  });
  await assert.rejects(
    () => getJobScoutInvite(token),
    (err: any) => err.status === 410,
  );
});

test("recordJobApplication uses jobApplicationId as the doc ID and a valid status", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-app-${Date.now()}`;
  const result = await recordJobApplication({
    userId: uid,
    company: "Acme",
    role: "Backend Engineer",
    status: "applied",
  });
  assert.equal(result.id, jobApplicationId(uid, "Acme", "Backend Engineer"));

  const snap = await db.collection("jobApplications").doc(result.id).get();
  assert.ok(snap.exists);
  const data = snap.data()!;
  assert.equal(data.company, "Acme"); // stored trimmed (only the doc ID lowercases)
  assert.equal(data.subscriptionId, `${uid}_jobs`);
  assert.ok(
    ["applied", "skipped", "action_required", "physical_submission", "failed"].includes(data.status),
    "status is one of the allowed enum values",
  );

  const listed = await listJobApplications(uid);
  assert.equal(listed.length, 1);
  assert.equal((listed[0] as any).id, result.id);
});

test("resetJobScoutProfileForPhone deletes only Job Scout setup data", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-reset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const otherUid = `${uid}-other`;
  const phone = "+213600000004";
  const hash = whatsappPhoneHash(phone);
  const cvFileRef = `${uid}/cv/cv.pdf`;
  const deletedObjects: string[] = [];

  await Promise.all([
    db.collection("users").doc(uid).set({
      profile: { email: "reset@example.com", displayName: "Reset User" },
    }),
    db.collection("phoneLinksByUser").doc(uid).set({
      userId: uid,
      phone,
      phoneHash: hash,
      status: "active",
    }),
    db.collection("phoneLinksByPhone").doc(hash).set({
      userId: uid,
      phone,
      phoneHash: hash,
      status: "active",
    }),
    db.collection("jobScoutDeliveryByPhone").doc(hash).set({
      userId: uid,
      phone,
      phoneHash: hash,
      status: "active",
    }),
    db.collection("jobScoutProfiles").doc(uid).set({
      userId: uid,
      cvFileRef,
      cvParsedText: "parsed CV text",
      preferences: { targetRoles: ["Any"], locations: ["Nationwide, Zimbabwe"], country: "zw" },
      setupStatus: "ready",
    }),
    db.collection("jobApplications").doc(`${uid}-app-1`).set({ userId: uid, company: "A", role: "One" }),
    db.collection("jobApplications").doc(`${uid}-app-2`).set({ userId: uid, company: "B", role: "Two" }),
    db.collection("jobApplications").doc(`${uid}-other-app`).set({ userId: otherUid, company: "C", role: "Three" }),
    db.collection("jobScoutInvites").doc(`${uid}-pending`).set({ phoneHash: hash, status: "pending" }),
    db.collection("jobScoutInvites").doc(`${uid}-completed`).set({ phoneHash: hash, status: "completed" }),
    db.collection("jobScoutInvites").doc(`${uid}-other-pending`).set({
      phoneHash: whatsappPhoneHash("+213600000005"),
      status: "pending",
    }),
  ]);

  const result = await resetJobScoutProfileForPhone(phone, {
    deleteObject: async (key: string) => {
      deletedObjects.push(key);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.userId, uid);
  assert.equal(result.profileDeleted, true);
  assert.equal(result.cvDeleted, true);
  assert.equal(result.applicationsDeleted, 2);
  assert.equal(result.invitesDeleted, 1);
  assert.deepEqual(deletedObjects, [cvFileRef]);

  assert.equal((await db.collection("jobScoutProfiles").doc(uid).get()).exists, false);
  assert.equal((await db.collection("jobApplications").where("userId", "==", uid).get()).size, 0);
  assert.equal((await db.collection("jobApplications").where("userId", "==", otherUid).get()).size, 1);
  assert.equal((await db.collection("jobScoutInvites").doc(`${uid}-pending`).get()).exists, false);
  assert.equal((await db.collection("jobScoutInvites").doc(`${uid}-completed`).get()).exists, true);
  assert.equal((await db.collection("jobScoutInvites").doc(`${uid}-other-pending`).get()).exists, true);
  assert.equal((await db.collection("users").doc(uid).get()).exists, true);
  assert.equal((await db.collection("phoneLinksByUser").doc(uid).get()).exists, true);
  assert.equal((await db.collection("phoneLinksByPhone").doc(hash).get()).exists, true);
  assert.equal((await db.collection("jobScoutDeliveryByPhone").doc(hash).get()).exists, true);
});
