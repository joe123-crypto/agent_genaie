import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import {
  httpError,
  normalizePhone,
  whatsappPhoneHash,
  validateFirebaseUid,
  jobApplicationId,
  normalizeJobPreferences,
  normalizeStringList,
  normalizeCvFileRef,
  isActivePhoneLink,
} from "@/src/lib/utils";
import { jobScoutTokenHash } from "@/src/security/crypto";
import { ensurePublicUserId } from "./users";
import { queuePhoneLinkCoreWrites, queueJobScoutPhoneDeliveryUpdate } from "./account-link";
import { config, assertPublicBaseUrl, JOB_SCOUT_SETUP_TTL_SECONDS } from "@/src/config";

export async function createJobScoutInvite(phoneInput: string, ttlSecondsInput?: number) {
  assertPublicBaseUrl();
  const phone = normalizePhone(phoneInput);
  const ttlSeconds = Number.isFinite(ttlSecondsInput)
    ? Math.max(60, Math.min(ttlSecondsInput as number, JOB_SCOUT_SETUP_TTL_SECONDS))
    : JOB_SCOUT_SETUP_TTL_SECONDS;
  const db = getFirestoreDb();
  const docRef = db.collection("jobScoutInvites").doc();
  const token = docRef.id;
  const hashedToken = jobScoutTokenHash(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await docRef.set({
    phone,
    phoneHash: whatsappPhoneHash(phone),
    tokenHash: hashedToken,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  return {
    token,
    setupUrl: `${config.publicBaseUrl}/job-scout/setup?token=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getJobScoutInvite(token: string) {
  if (!token || typeof token !== "string") throw httpError(400, "Token is required.");
  const hashedToken = jobScoutTokenHash(token);
  const db = getFirestoreDb();
  const docRef = db.collection("jobScoutInvites").doc(token);
  const doc = await docRef.get();
  if (!doc.exists) throw httpError(404, "Invalid or expired invite.");
  const data = doc.data()!;
  if (data.tokenHash !== hashedToken) throw httpError(404, "Invalid or expired invite.");
  if (data.status !== "pending") throw httpError(410, "This invite has already been used.");
  if (data.expiresAt?.toDate && data.expiresAt.toDate() < new Date()) {
    throw httpError(410, "This invite has expired.");
  }
  return { id: doc.id, ...data } as { id: string; [key: string]: any };
}

export async function bindJobScoutInviteToUser(token: string, firebaseUser: any) {
  const safeUid = validateFirebaseUid(firebaseUser.uid);
  const invite = await getJobScoutInvite(token);
  const db = getFirestoreDb();
  const centralRef = db.collection("users").doc(safeUid);
  const inviteRef = db.collection("jobScoutInvites").doc(invite.id);
  const now = FieldValue.serverTimestamp();
  const phoneInput = invite.phone;
  await db.runTransaction(async (t) => {
    const inviteCheck = await t.get(inviteRef);
    if (!inviteCheck.exists || inviteCheck.data()?.status !== "pending") {
      throw httpError(410, "This invite has already been used.");
    }
    const userDoc = await t.get(centralRef);
    if (!userDoc.exists) {
      throw httpError(404, "User profile not found. Please sign in again.");
    }
    const userData = userDoc.data() || {};
    const existingPublicId = userData.publicUserId;
    const publicId = await ensurePublicUserId(db, safeUid, existingPublicId, t);
    const phoneLink = {
      userId: safeUid,
      publicUserId: publicId,
      phone: phoneInput,
      phoneHash: whatsappPhoneHash(phoneInput),
      verifiedAt: now,
      status: "active",
      services: {
        webetu: userData.services?.webetu === "subscribed",
        jobs: true,
      },
    };
    queuePhoneLinkCoreWrites(t as any, db, safeUid, phoneLink, now);
    queueJobScoutPhoneDeliveryUpdate(t as any, db, phoneLink);
    t.update(inviteRef, {
      status: "completed",
      usedBy: safeUid,
      usedAt: now,
    });
    t.update(centralRef, {
      "services.jobs": "subscribed",
      updatedAt: now,
    });
  });
  return { success: true };
}

export async function findJobScoutUserByPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const hash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const deliveryDoc = await db.collection("jobScoutDeliveryByPhone").doc(hash).get();
  if (!deliveryDoc.exists || deliveryDoc.data()?.status !== "active") {
    return null;
  }
  return deliveryDoc.data()!.userId;
}

export async function saveJobScoutProfile(body: any) {
  const safeUid = validateFirebaseUid(body.userId);
  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(profileRef);
    if (doc.exists) {
      t.update(profileRef, {
        preferences: normalizeJobPreferences(body.preferences),
        cvFileRef: body.cvFileRef ? normalizeCvFileRef(body.cvFileRef) : null,
        cvParsedText: body.cvParsedText ? String(body.cvParsedText).slice(0, 50000) : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(profileRef, {
        userId: safeUid,
        preferences: normalizeJobPreferences(body.preferences),
        cvFileRef: body.cvFileRef ? normalizeCvFileRef(body.cvFileRef) : null,
        cvParsedText: body.cvParsedText ? String(body.cvParsedText).slice(0, 50000) : null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { ok: true };
}

export async function listJobScoutSubscribers(limitInput: number) {
  const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(limitInput, 100)) : 50;
  const db = getFirestoreDb();
  const snap = await db.collection("jobScoutProfiles").limit(limit).get();

  return Promise.all(snap.docs.map(async (doc) => {
    const profile = doc.data();
    const uid = doc.id;

    const [phoneDoc, userDoc, gmailCredDoc] = await Promise.all([
      db.collection("phoneLinksByUser").doc(uid).get(),
      db.collection("users").doc(uid).get(),
      db.collection("credentialRefs").doc(`gmail_oauth_token_${uid}`).get(),
    ]);

    const phoneData = phoneDoc.exists ? phoneDoc.data() || {} : {};
    const userData = userDoc.exists ? userDoc.data() || {} : {};
    const gmailData = gmailCredDoc.exists ? gmailCredDoc.data() || {} : {};

    const rawPhone = isActivePhoneLink(phoneData) ? phoneData.phone : null;
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const hash = phone ? whatsappPhoneHash(phone) : (phoneData.phoneHash as string | null | undefined) || null;
    const senderEmail = (gmailData.metadata as any)?.senderEmail || null;

    return {
      ...profile,
      whatsappPhone: phone,
      whatsappPhoneHash: hash,
      senderEmail,
      profile: {
        email: (userData.profile as any)?.email || null,
        displayName: (userData.profile as any)?.displayName || null,
      },
    };
  }));
}

export async function listJobApplications(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const snap = await db.collection("jobApplications").where("userId", "==", safeUid).get();
  return snap.docs.map((doc) => doc.data());
}

export async function recordJobApplication(body: any) {
  const safeUid = validateFirebaseUid(body.userId);
  const company = String(body.company ?? "").trim();
  const role = String(body.role ?? "").trim();
  if (!company) throw httpError(400, "company is required.");
  if (!role) throw httpError(400, "role is required.");
  const db = getFirestoreDb();
  const id = jobApplicationId(safeUid, company, role);
  const docRef = db.collection("jobApplications").doc(id);
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    if (!doc.exists) {
      t.set(docRef, {
        id,
        userId: safeUid,
        company,
        role,
        source: String(body.source ?? "").trim() || "agent",
        url: String(body.url ?? "").trim() || null,
        notes: normalizeStringList(body.notes),
        appliedAt: now,
      });
    }
  });
  return { ok: true, id };
}
