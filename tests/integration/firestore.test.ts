import { test } from "node:test";
import assert from "node:assert/strict";

import { getFirebaseAdminAuth, getFirestoreDb } from "@/src/firebase/admin";
import { config } from "@/src/config";
import { credentialRefId, jobApplicationId, tokenStoreKeyForUid, whatsappPhoneHash } from "@/src/lib/utils";
import { saveUserTokens } from "@/src/domains/local-store";
import {
  bindAccountLinkInviteToUser,
  createAccountLinkInvite,
  createSignedInWhatsAppLinkRequest,
  getAccountLinkInvite,
  revokeSignedInWhatsAppLink,
} from "@/src/domains/account-link";
import {
  saveJobScoutProfile,
  getJobScoutStatusForUser,
  recordJobApplication,
  listJobApplications,
  resetJobScoutProfileForPhone,
} from "@/src/domains/job-scout";
import { listDashboardTasksForUser, upsertDashboardTaskStatus } from "@/src/domains/dashboard";
import { syncUserToCentralData } from "@/src/domains/users";

// Live round-trip against the Firestore emulator (started by CI via
// `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST). This proves the
// real admin SDK writes the document *structures* the rest of the system — and
// the genaebot worker — depends on. When there's no emulator, the suite skips so
// `npm test` never touches a real database.
const skip = !process.env.FIRESTORE_EMULATOR_HOST;
const opts = { skip: skip && "FIRESTORE_EMULATOR_HOST not set" };
const authOpts = {
  skip: (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
    && "FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST not set",
};

config.whatsappBotPhone = "+213600099999";

test("syncUserToCentralData reports new vs existing onboarding state", authOpts, async () => {
  const db = getFirestoreDb();
  const auth = getFirebaseAdminAuth();
  const uid = `it-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await auth.createUser({
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    displayName: "Sync User",
  });

  const first = await syncUserToCentralData(uid);
  assert.equal(first.isNewUser, true);
  assert.equal(first.onboardingRequired, true);
  assert.ok(first.publicUserId);
  assert.match(first.publicUserId, /^usr_[A-Za-z0-9_-]{16}$/);

  const doc = await db.collection("users").doc(uid).get();
  assert.equal(doc.data()?.onboarding?.status, "required");

  const second = await syncUserToCentralData(uid);
  assert.equal(second.isNewUser, false);
  assert.equal(second.onboardingRequired, true);
  assert.equal(second.publicUserId, first.publicUserId);

  await db.collection("users").doc(uid).set({ onboarding: { status: "skipped" } }, { merge: true });
  const skipped = await syncUserToCentralData(uid);
  assert.equal(skipped.isNewUser, false);
  assert.equal(skipped.onboardingRequired, false);
});

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
      onboarding: { selectedService: "jobs", channel: "chat", status: "in_progress" },
    }),
    db.collection("credentialRefs").doc(credentialRefId(uid, "gmail", "oauth2")).set({
      userId: uid,
      service: "gmail",
      purpose: "oauth2",
      status: "active",
    }),
  ]);
  saveUserTokens(tokenStoreKeyForUid(uid), {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    expiry_date: Date.now() + 3600_000,
  });
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
  assert.equal((await db.collection("users").doc(uid).get()).data()?.onboarding?.status, "completed");
});

test("Job Scout uses the canonical account-link invite and WhatsApp page", opts, async () => {
  const { token, setupUrl } = await createAccountLinkInvite({
    phone: "+213600000001",
    purpose: "jobs",
    nextPath: "/onboarding",
    onboardingService: "jobs",
    onboardingChannel: "web",
  });
  const invite = await getAccountLinkInvite(token);
  assert.equal(invite.status, "pending");
  assert.equal(invite.phone, "+213600000001");
  assert.match(invite.phoneHash, /^[0-9a-f]{12}$/);
  assert.equal(invite.onboardingService, "jobs");
  assert.equal(invite.onboardingChannel, "web");
  assert.match(setupUrl, /\/whatsapp\?token=/);
  assert.ok(invite.expiresAt, "expiresAt present");
});

test("account-link confirmation selects the requested onboarding branch without reopening finished onboarding", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-onboarding-link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const phone = "+213600000112";
  await db.collection("users").doc(uid).set({
    profile: { email: "finished@example.com" },
    publicUserId: "usr_finished00000000",
    onboarding: { selectedService: "webetu", status: "completed" },
    services: { jobs: "not_subscribed" },
  });
  const { token } = await createAccountLinkInvite({
    phone,
    purpose: "jobs",
    nextPath: "/onboarding",
    onboardingService: "jobs",
    onboardingChannel: "chat",
  });

  const result = await bindAccountLinkInviteToUser(token, { uid });
  const user = (await db.collection("users").doc(uid).get()).data()!;
  assert.equal(result.onboardingChannel, "chat");
  assert.equal(user.onboarding.status, "completed");
  assert.equal(user.onboarding.selectedService, "jobs");
  assert.equal(user.onboarding.channel, "chat");
  assert.equal(user.services.jobs, "subscribed");
});

test("a newer onboarding channel supersedes the older pending invite", opts, async () => {
  const phone = "+213600000113";
  const first = await createAccountLinkInvite({
    phone,
    purpose: "jobs",
    nextPath: "/onboarding",
    onboardingService: "jobs",
    onboardingChannel: "chat",
  });
  const second = await createAccountLinkInvite({
    phone,
    purpose: "jobs",
    nextPath: "/onboarding",
    onboardingService: "jobs",
    onboardingChannel: "web",
    supersedePending: true,
  });

  await assert.rejects(
    () => getAccountLinkInvite(first.token),
    (err: any) => err.status === 410,
  );
  assert.equal((await getAccountLinkInvite(second.token)).onboardingChannel, "web");
});

test("createSignedInWhatsAppLinkRequest creates a pending account invite and bot handoff", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-wa-request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.collection("users").doc(uid).set({
    profile: { email: "wa-request@example.com", displayName: "WA Request" },
    publicUserId: "usr_abcdefghijklmnop",
  });

  const result = await createSignedInWhatsAppLinkRequest(uid, "+213600000101");
  assert.equal(result.pending, true);
  assert.equal(result.whatsappLinked, false);
  assert.match(result.setupUrl, /\/whatsapp\?token=/);
  assert.ok(result.whatsappBotUrl);
  assert.match(result.whatsappBotUrl, /^https:\/\/wa\.me\/213600099999\?text=/);

  const snap = await db.collection("accountLinkInvites").where("phoneHash", "==", whatsappPhoneHash("+213600000101")).get();
  assert.equal(snap.size, 1);
  assert.equal(snap.docs[0].data().purpose, "account");
  assert.equal(snap.docs[0].data().nextPath, "/whatsapp");
});

test("createSignedInWhatsAppLinkRequest can return to onboarding", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-wa-onboarding-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.collection("users").doc(uid).set({
    profile: { email: "wa-onboarding@example.com", displayName: "WA Onboarding" },
    publicUserId: "usr_onboarding0000",
  });

  await createSignedInWhatsAppLinkRequest(uid, "+213600000111", { nextPath: "/onboarding" });

  const snap = await db.collection("accountLinkInvites").where("phoneHash", "==", whatsappPhoneHash("+213600000111")).get();
  assert.equal(snap.size, 1);
  assert.equal(snap.docs[0].data().nextPath, "/onboarding");
});

test("createSignedInWhatsAppLinkRequest requires revoke before a different active number", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-wa-conflict-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const phone = "+213600000102";
  await Promise.all([
    db.collection("users").doc(uid).set({
      profile: { email: "wa-conflict@example.com", displayName: "WA Conflict" },
      publicUserId: "usr_bcdefghijklmnopq",
    }),
    db.collection("phoneLinksByUser").doc(uid).set({
      userId: uid,
      phone,
      phoneHash: whatsappPhoneHash(phone),
      status: "active",
    }),
  ]);

  await assert.rejects(
    () => createSignedInWhatsAppLinkRequest(uid, "+213600000103"),
    (err: any) => err.status === 409,
  );
});

test("dashboard telemetry upsert writes the live task status shape", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-dashboard-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.collection("users").doc(uid).set({
    profile: { email: "dashboard@example.com", displayName: "Dashboard User" },
    publicUserId: "usr_dashboard000000",
  });

  const result = await upsertDashboardTaskStatus({
    userId: uid,
    taskId: "reserve_meals",
    service: "webetu",
    enabled: true,
    status: "active",
    scheduleLabel: "Daily - 10:00 AM",
    timezone: "Africa/Algiers",
    nextRunAt: "2026-07-17T09:00:00.000Z",
    lastRunAt: "2026-07-16T06:45:00.000Z",
    lastRunStatus: "success",
    lastRunSummary: "Meals reserved",
  });
  assert.equal(result.ok, true);

  const telemetry = await listDashboardTasksForUser(uid);
  assert.equal(telemetry.tasks.length, 1);
  assert.deepEqual(telemetry.tasks[0], {
    enabled: true,
    lastRunAt: "2026-07-16T06:45:00.000Z",
    lastRunStatus: "success",
    lastRunSummary: "Meals reserved",
    nextRunAt: "2026-07-17T09:00:00.000Z",
    scheduleLabel: "Daily - 10:00 AM",
    service: "webetu",
    status: "active",
    taskId: "reserve_meals",
    timezone: "Africa/Algiers",
    updatedAt: telemetry.tasks[0].updatedAt,
  });
  assert.ok(telemetry.tasks[0].updatedAt);
});

test("bindAccountLinkInviteToUser does not overwrite an existing user phone link", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-wa-bind-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const currentPhone = "+213600000104";
  const nextPhone = "+213600000105";
  await Promise.all([
    db.collection("users").doc(uid).set({
      profile: { email: "wa-bind-user@example.com", displayName: "WA Bind User" },
      publicUserId: "usr_cdefghijklmnopqr",
    }),
    db.collection("phoneLinksByUser").doc(uid).set({
      userId: uid,
      phone: currentPhone,
      phoneHash: whatsappPhoneHash(currentPhone),
      status: "active",
    }),
  ]);
  const { token } = await createAccountLinkInvite({ phone: nextPhone, purpose: "account", nextPath: "/whatsapp" });

  await assert.rejects(
    () => bindAccountLinkInviteToUser(token, { uid }),
    (err: any) => err.status === 409,
  );
  const link = (await db.collection("phoneLinksByUser").doc(uid).get()).data()!;
  assert.equal(link.phoneHash, whatsappPhoneHash(currentPhone));
});

test("bindAccountLinkInviteToUser rejects phones already linked to another user", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-wa-bind-phone-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const otherUid = `${uid}-other`;
  const phone = "+213600000106";
  const hash = whatsappPhoneHash(phone);
  await Promise.all([
    db.collection("users").doc(uid).set({
      profile: { email: "wa-bind-phone@example.com", displayName: "WA Bind Phone" },
      publicUserId: "usr_defghijklmnopqrs",
    }),
    db.collection("phoneLinksByPhone").doc(hash).set({
      userId: otherUid,
      phone,
      phoneHash: hash,
      status: "active",
    }),
  ]);
  const { token } = await createAccountLinkInvite({ phone, purpose: "account", nextPath: "/whatsapp" });

  await assert.rejects(
    () => bindAccountLinkInviteToUser(token, { uid }),
    (err: any) => err.status === 409,
  );
  assert.equal((await db.collection("phoneLinksByUser").doc(uid).get()).exists, false);
});

test("getJobScoutStatusForUser evaluates signed-in Job Scout readiness", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-status-${Date.now()}`;
  const phone = "+213600000006";
  await Promise.all([
    db.collection("users").doc(uid).set({
      profile: { email: "status@example.com", displayName: "Status User" },
    }),
    db.collection("phoneLinksByUser").doc(uid).set({
      userId: uid,
      phone,
      phoneHash: whatsappPhoneHash(phone),
      status: "active",
    }),
    db.collection("credentialRefs").doc(credentialRefId(uid, "gmail", "oauth2")).set({
      userId: uid,
      service: "gmail",
      purpose: "oauth2",
      status: "active",
    }),
    db.collection("jobScoutProfiles").doc(uid).set({
      userId: uid,
      preferences: { targetRoles: ["Developer"], locations: ["Algiers, Algeria"], country: "dz" },
      setupStatus: "draft",
    }),
  ]);
  saveUserTokens(tokenStoreKeyForUid(uid), {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    expiry_date: Date.now() + 3600_000,
  });

  const status = await getJobScoutStatusForUser(uid);
  assert.equal(status.configured, true);
  assert.equal(status.linked, true);
  assert.equal(status.gmailConnected, true);
  assert.equal(status.profile.displayName, "Status User");
  assert.deepEqual(status.preferences.targetRoles, ["Developer"]);
  assert.equal(status.ready, false);
  assert.ok(status.missingRequirements.includes("cv"));
  assert.ok(status.missingRequirements.includes("profile_confirmation"));
  assert.ok(status.missingRequirements.includes("safety_acknowledgement"));
});

test("getJobScoutStatusForUser rejects tokenless Gmail refs", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-tokenless-${Date.now()}`;
  const phone = "+213600000016";
  await Promise.all([
    db.collection("users").doc(uid).set({
      profile: { email: "tokenless@example.com", displayName: "Tokenless User" },
    }),
    db.collection("phoneLinksByUser").doc(uid).set({
      userId: uid,
      phone,
      phoneHash: whatsappPhoneHash(phone),
      status: "active",
    }),
    db.collection("credentialRefs").doc(credentialRefId(uid, "gmail", "oauth2")).set({
      userId: uid,
      service: "gmail",
      purpose: "oauth2",
      status: "active",
    }),
    db.collection("jobScoutProfiles").doc(uid).set({
      userId: uid,
      preferences: { targetRoles: ["Developer"], locations: ["Algiers, Algeria"], country: "dz" },
      cvFileRef: `${uid}/cv/cv.pdf`,
      profileConfirmedAt: new Date(),
      safetyAcknowledgedAt: new Date(),
      onboardingVersion: 2,
    }),
  ]);

  const status = await getJobScoutStatusForUser(uid, {
    objectExists: async (key: string) => key === `${uid}/cv/cv.pdf`,
  });
  assert.equal(status.gmailConnected, false);
  assert.equal(status.senderEmail, null);
  assert.equal(status.ready, false);
  assert.ok(status.missingRequirements.includes("gmail_connection"));
  assert.ok(status.missingRequirements.includes("sender_email"));
});

test("getAccountLinkInvite rejects a tampered token", opts, async () => {
  const { token } = await createAccountLinkInvite({ phone: "+213600000002" });
  await assert.rejects(() => getAccountLinkInvite(`${token}tampered`));
});

test("getAccountLinkInvite rejects an expired invite (410)", opts, async () => {
  const db = getFirestoreDb();
  const ref = db.collection("accountLinkInvites").doc();
  const token = ref.id;
  const { accountLinkTokenHash } = await import("@/src/security/crypto");
  await ref.set({
    phone: "+213600000003",
    phoneHash: "abcabcabcabc",
    tokenHash: accountLinkTokenHash(token),
    status: "pending",
    expiresAt: new Date(Date.now() - 60_000), // already expired
  });
  await assert.rejects(
    () => getAccountLinkInvite(token),
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

test("resetJobScoutProfileForPhone leaves inert legacy invite documents untouched", opts, async () => {
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
    // The legacy collection has no active route or reader. Historical documents
    // are deliberately left untouched rather than destructively migrated here.
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
  assert.equal(Object.hasOwn(result, "invitesDeleted"), false);
  assert.deepEqual(deletedObjects, [cvFileRef]);

  assert.equal((await db.collection("jobScoutProfiles").doc(uid).get()).exists, false);
  assert.equal((await db.collection("jobApplications").where("userId", "==", uid).get()).size, 0);
  assert.equal((await db.collection("jobApplications").where("userId", "==", otherUid).get()).size, 1);
  assert.equal((await db.collection("jobScoutInvites").doc(`${uid}-pending`).get()).exists, true);
  assert.equal((await db.collection("jobScoutInvites").doc(`${uid}-completed`).get()).exists, true);
  assert.equal((await db.collection("jobScoutInvites").doc(`${uid}-other-pending`).get()).exists, true);
  assert.equal((await db.collection("users").doc(uid).get()).exists, true);
  assert.equal((await db.collection("phoneLinksByUser").doc(uid).get()).exists, true);
  assert.equal((await db.collection("phoneLinksByPhone").doc(hash).get()).exists, true);
  assert.equal((await db.collection("jobScoutDeliveryByPhone").doc(hash).get()).exists, true);
});

test("revokeSignedInWhatsAppLink marks active link and delivery records revoked", opts, async () => {
  const db = getFirestoreDb();
  const uid = `it-wa-revoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const phone = "+213600000107";
  const hash = whatsappPhoneHash(phone);
  await Promise.all([
    db.collection("users").doc(uid).set({
      profile: { email: "wa-revoke@example.com", displayName: "WA Revoke" },
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
    db.collection("webetuDeliveryByPhone").doc(hash).set({
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
  ]);

  const result = await revokeSignedInWhatsAppLink(uid);
  assert.equal(result.revoked, true);
  assert.equal((await db.collection("phoneLinksByUser").doc(uid).get()).data()!.status, "revoked");
  assert.equal((await db.collection("phoneLinksByPhone").doc(hash).get()).data()!.status, "revoked");
  assert.equal((await db.collection("webetuDeliveryByPhone").doc(hash).get()).data()!.status, "revoked");
  assert.equal((await db.collection("jobScoutDeliveryByPhone").doc(hash).get()).data()!.status, "revoked");
});
