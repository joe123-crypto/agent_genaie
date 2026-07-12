import fsSync from "node:fs";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import {
  httpError,
  normalizePhone,
  whatsappPhoneHash,
  maskPhone,
  isActivePhoneLink,
  pendingCacheEntryIsUsable,
  pendingCacheEntryMatches,
  normalizeAccountLinkPurpose,
  normalizeAccountLinkNextPath,
  validateFirebaseUid,
} from "@/src/lib/utils";
import { accountLinkTokenHash } from "@/src/security/crypto";
import { ensurePublicUserId } from "./users";
import { config, assertPublicBaseUrl, ACCOUNT_LINK_SETUP_TTL_SECONDS } from "@/src/config";

export function readPendingLinksCache() {
  const cachePath = config.pendingLinksCachePath;
  if (!fsSync.existsSync(cachePath)) return [];
  try {
    const data = fsSync.readFileSync(cachePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Failed to read pending links cache:", err);
    return [];
  }
}

export function writePendingLinksCache(links: any[]) {
  const cachePath = config.pendingLinksCachePath;
  fsSync.mkdirSync(path.dirname(cachePath), { recursive: true });
  fsSync.writeFileSync(cachePath, JSON.stringify(links, null, 2), "utf8");
}

export function removePendingLinksFromCache(criteria: any) {
  const now = Date.now();
  const current = readPendingLinksCache();
  const valid = current.filter(
    (entry: any) => pendingCacheEntryIsUsable(entry, now) && !pendingCacheEntryMatches(entry, criteria)
  );
  writePendingLinksCache(valid);
}

export async function createAccountLinkInvite(body: any) {
  assertPublicBaseUrl();
  const phone = normalizePhone(body.phone);
  const purpose = normalizeAccountLinkPurpose(body.purpose);
  const nextPath = normalizeAccountLinkNextPath(body.nextPath);
  const ttlSeconds = Number.isFinite(body.ttlSeconds)
    ? Math.max(60, Math.min(body.ttlSeconds, ACCOUNT_LINK_SETUP_TTL_SECONDS))
    : ACCOUNT_LINK_SETUP_TTL_SECONDS;
  const db = getFirestoreDb();
  const docRef = db.collection("accountLinkInvites").doc();
  const token = docRef.id;
  const hashedToken = accountLinkTokenHash(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await docRef.set({
    phone,
    phoneHash: whatsappPhoneHash(phone),
    tokenHash: hashedToken,
    purpose,
    nextPath,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  const setupUrl = `${config.publicBaseUrl}/account-link/setup?token=${token}`;
  const cacheEntry = {
    phone,
    phoneHash: whatsappPhoneHash(phone),
    service: "account-link",
    purpose,
    nextPath,
    setupUrl,
    expiresAt: expiresAt.toISOString(),
  };
  const currentLinks = readPendingLinksCache();
  currentLinks.push(cacheEntry);
  writePendingLinksCache(currentLinks);
  return { token, setupUrl, expiresAt: expiresAt.toISOString() };
}

export async function getAccountLinkInvite(token: string) {
  if (!token || typeof token !== "string") throw httpError(400, "Token is required.");
  const hashedToken = accountLinkTokenHash(token);
  const db = getFirestoreDb();
  const docRef = db.collection("accountLinkInvites").doc(token);
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

export async function bindAccountLinkInviteToUser(token: string, firebaseUser: any) {
  const safeUid = validateFirebaseUid(firebaseUser.uid);
  const invite = await getAccountLinkInvite(token);
  const db = getFirestoreDb();
  const centralRef = db.collection("users").doc(safeUid);
  const inviteRef = db.collection("accountLinkInvites").doc(invite.id);
  const now = FieldValue.serverTimestamp();
  const phoneInput = invite.phone;
  const phoneHash = whatsappPhoneHash(phoneInput);
  let nextPath = invite.nextPath || "/";
  let publicUserId: string | null = null;
  await db.runTransaction(async (t) => {
    const inviteCheck = await t.get(inviteRef);
    if (!inviteCheck.exists || inviteCheck.data()?.status !== "pending") {
      throw httpError(410, "This invite has already been used.");
    }
    const userDoc = await t.get(centralRef);
    if (!userDoc.exists) {
      throw httpError(404, "User profile not found. Please sign in again.");
    }
    const byUserRef = db.collection("phoneLinksByUser").doc(safeUid);
    const byPhoneRef = db.collection("phoneLinksByPhone").doc(phoneHash);
    const [existingUserLinkDoc, existingPhoneLinkDoc] = await Promise.all([
      t.get(byUserRef),
      t.get(byPhoneRef),
    ]);
    const existingUserLink = existingUserLinkDoc.exists ? existingUserLinkDoc.data() || {} : {};
    const existingPhoneLink = existingPhoneLinkDoc.exists ? existingPhoneLinkDoc.data() || {} : {};
    const existingUserHash = existingUserLink.phoneHash || (existingUserLink.phone ? whatsappPhoneHash(existingUserLink.phone) : null);
    if (isActivePhoneLink(existingUserLink) && existingUserHash !== phoneHash) {
      throw httpError(409, "Revoke the current WhatsApp link before linking a new number.");
    }
    if (isActivePhoneLink(existingPhoneLink) && existingPhoneLink.userId !== safeUid) {
      throw httpError(409, "This WhatsApp phone is already linked to another app account.");
    }
    const userData = userDoc.data() || {};
    const existingPublicId = userData.publicUserId;
    const publicId = await ensurePublicUserId(db, safeUid, existingPublicId, t);
    publicUserId = publicId;
    const phoneLink = {
      userId: safeUid,
      publicUserId: publicId,
      phone: phoneInput,
      phoneHash,
      verifiedAt: now,
      status: "active",
      services: {
        webetu: userData.services?.webetu === "subscribed",
        jobs: userData.services?.jobs === "subscribed",
      },
    };
    queuePhoneLinkCoreWrites(t as any, db, safeUid, phoneLink, now);
    t.update(inviteRef, {
      status: "completed",
      usedBy: safeUid,
      usedAt: now,
    });
    if (invite.purpose === "webetu" && userData.services?.webetu !== "subscribed") {
      t.update(centralRef, {
        "services.webetu": "subscribed",
        updatedAt: now,
      });
      queueWebetuPhoneDeliveryUpdate(t as any, db, phoneLink);
    } else if (invite.purpose === "jobs" && userData.services?.jobs !== "subscribed") {
      t.update(centralRef, {
        "services.jobs": "subscribed",
        updatedAt: now,
      });
      queueJobScoutPhoneDeliveryUpdate(t as any, db, phoneLink);
    }
    nextPath = invite.nextPath;
  });
  try {
    removePendingLinksFromCache({ phoneHash: whatsappPhoneHash(phoneInput), purpose: invite.purpose });
  } catch (err) {
    console.error("Failed to remove pending link from cache after successful bind:", err);
  }
  return { success: true, nextPath, publicUserId };
}

export function queuePhoneLinkCoreWrites(batch: any, db: any, userId: string, phoneLink: any, now: any) {
  const hash = phoneLink.phoneHash;
  const byPhoneRef = db.collection("phoneLinksByPhone").doc(hash);
  const byUserRef = db.collection("phoneLinksByUser").doc(userId);
  const record = {
    userId,
    publicUserId: phoneLink.publicUserId,
    phoneHash: hash,
    phone: phoneLink.phone,
    status: phoneLink.status,
    verifiedAt: phoneLink.verifiedAt || now,
    updatedAt: now,
  };
  batch.set(byPhoneRef, record);
  batch.set(byUserRef, record);
  return record;
}

export function queueWebetuPhoneDeliveryUpdate(batch: any, db: any, phoneLink: any) {
  const docRef = db.collection("webetuDeliveryByPhone").doc(phoneLink.phoneHash);
  batch.set(docRef, {
    userId: phoneLink.userId,
    phoneHash: phoneLink.phoneHash,
    phone: phoneLink.phone,
    status: phoneLink.status,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export function queueJobScoutPhoneDeliveryUpdate(batch: any, db: any, phoneLink: any) {
  const docRef = db.collection("jobScoutDeliveryByPhone").doc(phoneLink.phoneHash);
  batch.set(docRef, {
    userId: phoneLink.userId,
    phoneHash: phoneLink.phoneHash,
    phone: phoneLink.phone,
    status: phoneLink.status,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function writePhoneLinkForUser(db: any, user: any, phoneInput: string, options: any = {}) {
  const phone = normalizePhone(phoneInput);
  const phoneHash = whatsappPhoneHash(phone);
  const safeUid = validateFirebaseUid(user.userId);
  const publicUserId = await ensurePublicUserId(db, safeUid, user.publicUserId);
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  const phoneLink = {
    userId: safeUid,
    publicUserId,
    phone,
    phoneHash,
    status: options.status ?? "active",
    verifiedAt: options.verifiedAt ?? now,
  };
  queuePhoneLinkCoreWrites(batch, db, safeUid, phoneLink, now);
  if (options.updateWebetuDelivery) queueWebetuPhoneDeliveryUpdate(batch, db, phoneLink);
  if (options.updateJobScoutDelivery) queueJobScoutPhoneDeliveryUpdate(batch, db, phoneLink);
  await batch.commit();
  return phoneLink;
}

export function whatsappBotLinkForRequest(setupUrl: string) {
  if (!config.whatsappBotPhone.trim()) throw httpError(500, "WHATSAPP_BOT_PHONE is not configured.");
  const botPhone = normalizePhone(config.whatsappBotPhone);
  const botDigits = botPhone.replace(/\D/g, "");
  const message = `Link my WhatsApp to Genaie: ${setupUrl}`;
  return `https://wa.me/${botDigits}?text=${encodeURIComponent(message)}`;
}

export async function createSignedInWhatsAppLinkRequest(uid: string, phoneInput: string) {
  const safeUid = validateFirebaseUid(uid);
  const phone = normalizePhone(phoneInput);
  const phoneHash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const [userDoc, byUserDoc, byPhoneDoc] = await Promise.all([
    db.collection("users").doc(safeUid).get(),
    db.collection("phoneLinksByUser").doc(safeUid).get(),
    db.collection("phoneLinksByPhone").doc(phoneHash).get(),
  ]);
  if (!userDoc.exists) throw httpError(404, "User profile not found. Please sign in again.");

  const existingUserLink = byUserDoc.exists ? byUserDoc.data() || {} : {};
  const existingPhoneLink = byPhoneDoc.exists ? byPhoneDoc.data() || {} : {};
  if (isActivePhoneLink(existingUserLink)) {
    const existingUserHash = existingUserLink.phoneHash || (existingUserLink.phone ? whatsappPhoneHash(existingUserLink.phone) : null);
    if (existingUserHash === phoneHash) {
      const setupUrl = "";
      return {
        pending: false,
        alreadyLinked: true,
        whatsappLinked: true,
        maskedPhone: maskPhone(phone),
        phoneHash: String(phoneHash).slice(0, 12),
        setupUrl,
        whatsappBotUrl: null,
      };
    }
    throw httpError(409, "Revoke the current WhatsApp link before linking a new number.");
  }
  if (isActivePhoneLink(existingPhoneLink) && existingPhoneLink.userId !== safeUid) {
    throw httpError(409, "This WhatsApp phone is already linked to another app account.");
  }
  if (!config.whatsappBotPhone.trim()) throw httpError(500, "WHATSAPP_BOT_PHONE is not configured.");

  const invite = await createAccountLinkInvite({
    phone,
    purpose: "account",
    nextPath: "/whatsapp",
  });
  return {
    pending: true,
    alreadyLinked: false,
    whatsappLinked: false,
    maskedPhone: maskPhone(phone),
    phoneHash: String(phoneHash).slice(0, 12),
    setupUrl: invite.setupUrl,
    expiresAt: invite.expiresAt,
    whatsappBotUrl: whatsappBotLinkForRequest(invite.setupUrl),
  };
}

export async function revokeSignedInWhatsAppLink(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const byUserRef = db.collection("phoneLinksByUser").doc(safeUid);
  const now = FieldValue.serverTimestamp();
  let phoneHash: string | null = null;
  await db.runTransaction(async (t) => {
    const byUserDoc = await t.get(byUserRef);
    if (!byUserDoc.exists || !isActivePhoneLink(byUserDoc.data())) return;
    const data = byUserDoc.data() || {};
    const phone = data.phone ? normalizePhone(data.phone) : null;
    phoneHash = data.phoneHash || (phone ? whatsappPhoneHash(phone) : null);
    const byPhoneRef = phoneHash ? db.collection("phoneLinksByPhone").doc(phoneHash) : null;
    const webetuRef = phoneHash ? db.collection("webetuDeliveryByPhone").doc(phoneHash) : null;
    const jobScoutRef = phoneHash ? db.collection("jobScoutDeliveryByPhone").doc(phoneHash) : null;
    const [byPhoneDoc, webetuDoc, jobScoutDoc] = await Promise.all([
      byPhoneRef ? t.get(byPhoneRef) : Promise.resolve(null),
      webetuRef ? t.get(webetuRef) : Promise.resolve(null),
      jobScoutRef ? t.get(jobScoutRef) : Promise.resolve(null),
    ]);
    const update = {
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    };
    t.set(byUserRef, update, { merge: true });
    if (!phoneHash) return;
    if (byPhoneRef && byPhoneDoc?.exists && byPhoneDoc.data()?.userId === safeUid) t.set(byPhoneRef, update, { merge: true });
    if (webetuRef && webetuDoc?.exists && webetuDoc.data()?.userId === safeUid) t.set(webetuRef, update, { merge: true });
    if (jobScoutRef && jobScoutDoc?.exists && jobScoutDoc.data()?.userId === safeUid) t.set(jobScoutRef, update, { merge: true });
  });
  if (phoneHash) {
    try {
      removePendingLinksFromCache({ phoneHash });
    } catch (err) {
      console.error("Failed to remove pending links from cache after WhatsApp revoke:", err);
    }
  }
  return { revoked: true };
}

function whatsAppLinkResult(phoneInput: string | null | undefined, phoneHashInput: string | null | undefined) {
  const phone = phoneInput ? normalizePhone(phoneInput) : null;
  const phoneHash = phoneHashInput || (phone ? whatsappPhoneHash(phone) : null);
  if (!phone || !phoneHash) return null;
  return {
    whatsappLinked: true,
    maskedPhone: maskPhone(phone),
    phoneHash: String(phoneHash).slice(0, 12),
  };
}

// Resolves an active WhatsApp link across the new and legacy data models.
// Order: new phoneLinksByUser collection → legacy phoneLinks collection
// (keyed by phoneHash, queried by userId) → legacy users/{uid}.identities.
export async function getWhatsAppLinkForUser(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const empty = { whatsappLinked: false, maskedPhone: null as string | null, phoneHash: null as string | null };

  const doc = await db.collection("phoneLinksByUser").doc(safeUid).get();
  if (doc.exists) {
    const data = doc.data() || {};
    if (isActivePhoneLink(data)) {
      const result = whatsAppLinkResult(data.phone, data.phoneHash);
      if (result) return result;
    }
  }

  return empty;
}

export async function readPhoneDependencyState(db: any, userId: string) {
  const [userDoc, phoneDoc] = await Promise.all([
    db.collection("users").doc(userId).get(),
    db.collection("phoneLinksByUser").doc(userId).get(),
  ]);
  const user = userDoc.exists ? { userId, ...userDoc.data() } : null;
  const link = phoneDoc.exists ? phoneDoc.data() : null;
  return { user, link, isActiveLink: isActivePhoneLink(link) };
}

export async function getAccountLinkStatusForPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const hash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const doc = await db.collection("phoneLinksByPhone").doc(hash).get();
  if (!doc.exists) return { linked: false };
  const data = doc.data() || {};
  if (!isActivePhoneLink(data)) return { linked: false, status: data.status };
  const centralDoc = await db.collection("users").doc(data.userId).get();
  const user = centralDoc.data();
  return {
    linked: true,
    status: "active",
    userId: data.userId,
    publicUserId: user?.publicUserId ?? null,
    services: user?.services ?? {},
  };
}

export async function getLinkedUserForWebetuPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const hash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const deliveryDoc = await db.collection("webetuDeliveryByPhone").doc(hash).get();
  if (!deliveryDoc.exists || !isActivePhoneLink(deliveryDoc.data())) {
    throw httpError(404, "No active Webetu subscription found for this phone number.");
  }
  return deliveryDoc.data()!.userId;
}
