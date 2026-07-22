import crypto from "node:crypto";
import { REVOKE_URL } from "@/src/config";
import { getFirebaseAdminAuth, getFirestoreDb } from "@/src/firebase/admin";
import { deleteUserTokens } from "@/src/domains/local-store";
import { loadGmailTokens } from "@/src/domains/gmail";
import { deleteObjectsByPrefix, listObjectKeysByPrefix } from "@/src/domains/r2-storage";
import {
  credentialRefId,
  httpError,
  normalizePhone,
  tokenStoreKeyForUid,
  validateFirebaseUid,
  whatsappPhoneHash,
} from "@/src/lib/utils";

const UID_DOCUMENT_COLLECTIONS = [
  "users",
  "phoneLinksByUser",
  "jobScoutProfiles",
  "webetuPreferences",
] as const;

const UID_QUERY_COLLECTIONS = [
  "credentialRefs",
  "jobApplications",
  "dashboardTaskStatus",
  "webetuOverrides",
  "phoneLinksByPhone",
  "jobScoutDeliveryByPhone",
  "webetuDeliveryByPhone",
] as const;

const PHONE_COLLECTIONS = [
  "phoneLinksByPhone",
  "jobScoutDeliveryByPhone",
  "webetuDeliveryByPhone",
  "phoneLinks",
] as const;

type ResetDependencies = {
  deleteLocalTokens: typeof deleteUserTokens;
  deleteObjectsByPrefix: typeof deleteObjectsByPrefix;
  listObjectKeysByPrefix: typeof listObjectKeysByPrefix;
  loadGmailTokens: typeof loadGmailTokens;
  revokeToken: (token: string) => Promise<"revoked" | "already_invalid">;
};

const defaultDependencies: ResetDependencies = {
  deleteLocalTokens: deleteUserTokens,
  deleteObjectsByPrefix,
  listObjectKeysByPrefix,
  loadGmailTokens,
  revokeToken: revokeGoogleToken,
};

function storagePrefix(uidInput: string) {
  const uid = validateFirebaseUid(uidInput);
  if (!/^[A-Za-z0-9._:@-]+$/.test(uid) || uid.includes("..")) {
    throw httpError(400, "User ID cannot be used in a storage path.");
  }
  return `${uid}/`;
}

function sortedUserIds(values: Iterable<unknown>) {
  return [...new Set([...values].map(validateFirebaseUid))].sort();
}

export function resetTargetFingerprint(phoneHash: string, userIds: Iterable<string>) {
  return crypto.createHash("sha256").update(JSON.stringify({
    phoneHash,
    userIds: sortedUserIds(userIds),
  })).digest("hex");
}

async function addQueryDocuments(target: Map<string, any>, collection: string, field: string, value: string) {
  const snap = await getFirestoreDb().collection(collection).where(field, "==", value).get();
  for (const doc of snap.docs) target.set(doc.ref.path, doc);
}

async function addDirectDocument(target: Map<string, any>, collection: string, id: string) {
  const doc = await getFirestoreDb().collection(collection).doc(id).get();
  if (doc.exists) target.set(doc.ref.path, doc);
}

function collectUserIdsFromDocuments(documents: Map<string, any>, userIds: Set<string>) {
  for (const doc of documents.values()) {
    const data = doc.data() || {};
    for (const candidate of [data.userId, data.usedBy]) {
      if (candidate) userIds.add(validateFirebaseUid(candidate));
    }
  }
}

async function discoverResetUserIds(phone: string) {
  const phoneHash = whatsappPhoneHash(phone);
  const userIds = new Set<string>();
  const phoneDocuments = new Map<string, any>();

  await Promise.all([
    ...PHONE_COLLECTIONS.map((collection) => addDirectDocument(phoneDocuments, collection, phoneHash)),
    ...PHONE_COLLECTIONS.map((collection) => addQueryDocuments(phoneDocuments, collection, "phoneHash", phoneHash)),
    addQueryDocuments(phoneDocuments, "phoneLinksByUser", "phoneHash", phoneHash),
    addQueryDocuments(phoneDocuments, "accountLinkInvites", "phoneHash", phoneHash),
  ]);
  collectUserIdsFromDocuments(phoneDocuments, userIds);

  const checkedUserIds = new Set<string>();
  const checkedEmails = new Set<string>();
  while ([...userIds].some((uid) => !checkedUserIds.has(uid))) {
    for (const uid of [...userIds]) {
      if (checkedUserIds.has(uid)) continue;
      checkedUserIds.add(uid);
      const userDoc = await getFirestoreDb().collection("users").doc(uid).get();
      if (!userDoc.exists) continue;
      const emailLower = String(userDoc.data()?.profile?.emailLower || "").trim().toLowerCase();
      if (!emailLower || checkedEmails.has(emailLower)) continue;
      checkedEmails.add(emailLower);
      const related = await getFirestoreDb().collection("users").where("profile.emailLower", "==", emailLower).get();
      for (const doc of related.docs) userIds.add(validateFirebaseUid(doc.id));
    }
  }

  return sortedUserIds(userIds);
}

async function collectResetDocuments(phone: string, userIds: string[]) {
  const phoneHash = whatsappPhoneHash(phone);
  const documents = new Map<string, any>();

  await Promise.all([
    ...PHONE_COLLECTIONS.map((collection) => addDirectDocument(documents, collection, phoneHash)),
    ...PHONE_COLLECTIONS.map((collection) => addQueryDocuments(documents, collection, "phoneHash", phoneHash)),
    addQueryDocuments(documents, "phoneLinksByUser", "phoneHash", phoneHash),
    addQueryDocuments(documents, "accountLinkInvites", "phoneHash", phoneHash),
  ]);

  for (const uid of userIds) {
    await Promise.all([
      ...UID_DOCUMENT_COLLECTIONS.map((collection) => addDirectDocument(documents, collection, uid)),
      ...UID_QUERY_COLLECTIONS.map((collection) => addQueryDocuments(documents, collection, "userId", uid)),
      addQueryDocuments(documents, "accountLinkInvites", "usedBy", uid),
      addQueryDocuments(documents, "credentialRefs", "userId", tokenStoreKeyForUid(uid)),
      addDirectDocument(documents, "credentialRefs", credentialRefId(uid, "gmail", "oauth2")),
      addDirectDocument(documents, "credentialRefs", `gmail_oauth_token_${uid}`),
    ]);
  }
  return documents;
}

async function existingAuthUserIds(userIds: string[]) {
  const auth = getFirebaseAdminAuth();
  const existing: string[] = [];
  for (const uid of userIds) {
    try {
      await auth.getUser(uid);
      existing.push(uid);
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return existing;
}

function countDocumentsByCollection(documents: Map<string, any>) {
  const counts: Record<string, number> = {};
  for (const path of documents.keys()) {
    const collection = path.split("/")[0];
    counts[collection] = (counts[collection] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export async function getUserResetInventory(
  phoneInput: string,
  seedUserIds: string[] = [],
  dependencies: Pick<ResetDependencies, "listObjectKeysByPrefix"> = defaultDependencies,
) {
  const phone = normalizePhone(phoneInput);
  const phoneHash = whatsappPhoneHash(phone);
  const discoveredUserIds = await discoverResetUserIds(phone);
  const userIds = sortedUserIds([...discoveredUserIds, ...seedUserIds]);
  const documents = await collectResetDocuments(phone, userIds);
  const objectCounts: Record<string, number> = {};
  for (const uid of userIds) {
    objectCounts[uid] = (await dependencies.listObjectKeysByPrefix(storagePrefix(uid))).length;
  }
  const authUserIds = await existingAuthUserIds(userIds);
  return {
    ok: true,
    phone,
    phoneHash,
    userIds,
    fingerprint: resetTargetFingerprint(phoneHash, userIds),
    documentCounts: countDocumentsByCollection(documents),
    documentTotal: documents.size,
    r2ObjectCounts: objectCounts,
    r2ObjectTotal: Object.values(objectCounts).reduce((sum, count) => sum + count, 0),
    authUserIds,
  };
}

async function revokeGoogleToken(token: string): Promise<"revoked" | "already_invalid"> {
  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok) return "revoked";
  const responseText = await response.text().catch(() => "");
  if (response.status === 400 && /invalid[_ -]?token/i.test(responseText)) return "already_invalid";
  throw httpError(502, `Google token revocation failed with status ${response.status}.`);
}

async function deleteDocumentBatch(documents: any[]) {
  const db = getFirestoreDb();
  for (let index = 0; index < documents.length; index += 400) {
    const batch = db.batch();
    for (const doc of documents.slice(index, index + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

export async function resetUserAccount(
  input: {
    confirmation: string;
    expectedUserIds: string[];
    fingerprint: string;
    phone: string;
    phoneHash: string;
  },
  dependencies: ResetDependencies = defaultDependencies,
) {
  const phone = normalizePhone(input.phone);
  const phoneHash = whatsappPhoneHash(phone);
  const expectedUserIds = sortedUserIds(input.expectedUserIds || []);
  if (input.phoneHash !== phoneHash) throw httpError(400, "phoneHash does not match phone.");
  if (input.confirmation !== `DELETE ${phone}`) throw httpError(400, `confirmation must be DELETE ${phone}`);
  if (!expectedUserIds.length) throw httpError(400, "expectedUserIds must not be empty.");
  if (input.fingerprint !== resetTargetFingerprint(phoneHash, expectedUserIds)) {
    throw httpError(400, "fingerprint does not match the requested reset target.");
  }

  const liveUserIds = await discoverResetUserIds(phone);
  const unexpectedUserIds = liveUserIds.filter((uid) => !expectedUserIds.includes(uid));
  if (unexpectedUserIds.length) {
    throw httpError(409, "Reset target changed; request a new inventory before deleting.");
  }

  const documents = await collectResetDocuments(phone, expectedUserIds);
  const googleRevocation: Record<string, string> = {};
  for (const uid of expectedUserIds) {
    const tokenStoreKey = tokenStoreKeyForUid(uid);
    const tokens = await dependencies.loadGmailTokens(tokenStoreKey);
    const token = String(tokens?.refresh_token || tokens?.access_token || "").trim();
    const activeGmailCredential = [...documents.values()].some((doc) => {
      if (doc.ref.path.split("/")[0] !== "credentialRefs") return false;
      const data = doc.data() || {};
      return data.service === "gmail"
        && data.status === "active"
        && (data.userId === uid || data.userId === tokenStoreKey);
    });
    if (!token && activeGmailCredential) {
      throw httpError(500, `Active Gmail credentials for ${uid} could not be decrypted; no account data was deleted.`);
    }
    googleRevocation[uid] = token ? await dependencies.revokeToken(token) : "not_present";
  }
  for (const uid of expectedUserIds) dependencies.deleteLocalTokens(tokenStoreKeyForUid(uid));

  const r2ObjectsDeleted: Record<string, number> = {};
  for (const uid of expectedUserIds) {
    r2ObjectsDeleted[uid] = await dependencies.deleteObjectsByPrefix(storagePrefix(uid));
  }

  const linkageCollections = new Set([
    "accountLinkInvites",
    "jobScoutDeliveryByPhone",
    "phoneLinks",
    "phoneLinksByPhone",
    "phoneLinksByUser",
    "webetuDeliveryByPhone",
  ]);
  const ordinaryDocuments = [...documents.values()].filter(
    (doc) => !linkageCollections.has(doc.ref.path.split("/")[0]),
  );
  const linkageDocuments = [...documents.values()].filter(
    (doc) => linkageCollections.has(doc.ref.path.split("/")[0]),
  );
  await deleteDocumentBatch(ordinaryDocuments);
  await deleteDocumentBatch(linkageDocuments);

  const auth = getFirebaseAdminAuth();
  const authUsersDeleted: string[] = [];
  for (const uid of expectedUserIds) {
    try {
      await auth.deleteUser(uid);
      authUsersDeleted.push(uid);
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }

  const remaining = await getUserResetInventory(phone, expectedUserIds, dependencies);
  if (remaining.documentTotal || remaining.r2ObjectTotal || remaining.authUserIds.length) {
    throw httpError(500, "Reset completed with remaining account state; inspect the returned inventory before retrying.");
  }

  return {
    ok: true,
    phone,
    phoneHash,
    userIds: expectedUserIds,
    googleRevocation,
    documentsDeleted: documents.size,
    r2ObjectsDeleted,
    authUsersDeleted,
    remaining,
  };
}
