import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb, getFirebaseAdminAuth } from "@/src/firebase/admin";
import { httpError, userProfileFromRecord, generatePublicUserId, validateFirebaseUid, normalizePhone, whatsappPhoneHash, maskPhone, isActivePhoneLink } from "@/src/lib/utils";

export const USER_PLANS = ["free", "pro", "ultra"] as const;
export type UserPlan = typeof USER_PLANS[number];

export function normalizeUserPlan(value: unknown): UserPlan | null {
  const plan = String(value ?? "").trim().toLowerCase();
  return USER_PLANS.includes(plan as UserPlan) ? plan as UserPlan : null;
}

export function hasSelectedPlan(value: unknown) {
  return normalizeUserPlan(value) !== null;
}

export function pricingGatePath(nextPath: string) {
  const path = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  return `/pricing?next=${encodeURIComponent(path)}`;
}

export async function syncUserToCentralData(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const auth = getFirebaseAdminAuth();
  const user = await auth.getUser(safeUid);
  const data = userProfileFromRecord(user);
  const centralRef = db.collection("users").doc(safeUid);
  let publicUserId: string | null = null;
  let isNewUser = false;
  let onboardingRequired = false;
  let plan: UserPlan | null = null;
  let planRequired = true;
  await db.runTransaction(async (t) => {
    const existing = await t.get(centralRef);
    if (!existing.exists) {
      const newPublicUserId = generatePublicUserId();
      publicUserId = newPublicUserId;
      isNewUser = true;
      onboardingRequired = true;
      plan = null;
      planRequired = true;
      t.set(centralRef, {
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        plan: null,
        publicUserId: newPublicUserId,
        onboarding: {
          status: "required",
          createdAt: FieldValue.serverTimestamp(),
        },
        services: {
          gmail: "not_connected",
          calendar: "not_connected",
          jobs: "not_subscribed",
          webetu: "not_subscribed",
          news: "not_subscribed",
        },
      });
    } else {
      const current = existing.data() || {};
      const newPublicId = await ensurePublicUserId(db, safeUid, current.publicUserId, t);
      publicUserId = newPublicId;
      onboardingRequired = onboardingStatusRequiresAttention(current.onboarding);
      plan = normalizeUserPlan(current.plan);
      planRequired = !plan;
      t.update(centralRef, {
        "profile.email": data.profile.email,
        "profile.emailLower": data.profile.emailLower,
        "profile.emailVerified": data.profile.emailVerified,
        "profile.displayName": data.profile.displayName,
        "profile.photoUrl": data.profile.photoUrl,
        "profile.firstName": data.profile.firstName,
        "profile.lastName": data.profile.lastName,
        identities: data.identities,
        "services.calendar": current.services?.calendar ?? "not_connected",
        updatedAt: FieldValue.serverTimestamp(),
        publicUserId: newPublicId,
      });
    }
  });
  return { publicUserId, isNewUser, onboardingRequired, plan, planRequired };
}

function onboardingStatusRequiresAttention(onboarding: any) {
  const status = String(onboarding?.status ?? "").trim();
  return status === "required" || status === "in_progress";
}

export async function ensurePublicUserId(db: any, firebaseUid: string, existingPublicUserId: string | null | undefined, transaction?: any) {
  if (existingPublicUserId && /^usr_[A-Za-z0-9_-]{16}$/.test(existingPublicUserId)) {
    return existingPublicUserId;
  }
  const newId = generatePublicUserId();
  const ref = db.collection("users").doc(firebaseUid);
  if (transaction) {
    transaction.update(ref, { publicUserId: newId });
  } else {
    await ref.update({ publicUserId: newId });
  }
  return newId;
}

export async function resolvePublicUser(publicUserId: string) {
  if (!publicUserId || !/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) return null;
  const db = getFirestoreDb();
  const snap = await db.collection("users").where("publicUserId", "==", publicUserId).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function assertNoDuplicateCentralEmail(firebaseUser: any) {
  if (!firebaseUser.email || !firebaseUser.emailVerified) return;
  const emailLower = String(firebaseUser.email).trim().toLowerCase();
  const db = getFirestoreDb();
  const centralSnap = await db.collection("users").where("profile.emailLower", "==", emailLower).get();
  for (const doc of centralSnap.docs) {
    if (doc.id !== firebaseUser.uid) {
      console.warn("Duplicate central email detected during authentication.");
      throw httpError(409, "An account with this email already exists.");
    }
  }
}

export async function getSignedInAccountStatus(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const [doc, phoneDoc] = await Promise.all([
    db.collection("users").doc(safeUid).get(),
    db.collection("phoneLinksByUser").doc(safeUid).get(),
  ]);
  if (!doc.exists) throw httpError(404, "User profile not found.");
  const data = doc.data() || {};

  let phone: string | null = null;
  let phoneHash: string | null = null;

  const link = phoneDoc.exists ? phoneDoc.data() || {} : {};
  if (phoneDoc.exists && isActivePhoneLink(link)) {
    phone = link.phone ? normalizePhone(link.phone) : null;
    phoneHash = link.phoneHash || (phone ? whatsappPhoneHash(phone) : null);
  }
  return {
    userId: safeUid,
    publicUserId: data.publicUserId ?? null,
    plan: normalizeUserPlan(data.plan),
    email: data.profile?.email ?? null,
    profile: {
      email: data.profile?.email ?? null,
      displayName: data.profile?.displayName ?? null,
      photoUrl: data.profile?.photoUrl ?? null,
    },
    services: {
      gmail: "not_connected",
      calendar: "not_connected",
      jobs: "not_subscribed",
      webetu: "not_subscribed",
      news: "not_subscribed",
      ...(data.services ?? {}),
    },
    whatsappLinked: Boolean(phone && phoneHash),
    maskedPhone: phone ? maskPhone(phone) : null,
    phoneHash: phoneHash ? String(phoneHash).slice(0, 12) : null,
  };
}

export async function selectSignedInPlan(uidInput: string, planInput: unknown) {
  const uid = validateFirebaseUid(uidInput);
  const plan = normalizeUserPlan(planInput);
  if (!plan) throw httpError(400, "plan must be free, pro, or ultra.");

  const db = getFirestoreDb();
  const userRef = db.collection("users").doc(uid);
  const doc = await userRef.get();
  if (!doc.exists) throw httpError(404, "User profile not found.");
  await userRef.set({
    plan,
    planSelectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { plan };
}

export async function updateSignedInDisplayName(uid: string, displayNameInput: unknown) {
  const safeUid = validateFirebaseUid(uid);
  const displayName = String(displayNameInput ?? "").replace(/\s+/g, " ").trim();
  if (!displayName) throw httpError(400, "Display name is required.");
  if (displayName.length > 120) throw httpError(400, "Display name is too long.");
  if (displayName.includes("\0")) throw httpError(400, "Display name is invalid.");

  const db = getFirestoreDb();
  await getFirebaseAdminAuth().updateUser(safeUid, { displayName });
  await db.collection("users").doc(safeUid).set({
    profile: {
      displayName,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { displayName };
}

export function scopedRouteForPath(pathname: string) {
  if (!pathname || pathname === "/") return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 0 && /^usr_[A-Za-z0-9_-]{16}$/.test(parts[0])) {
    return { publicUserId: parts[0], restPath: "/" + parts.slice(1).join("/") };
  }
  return null;
}

export function scopedRouteLocation(publicUserId: string, rest: string) {
  const id = publicUserId;
  const path = String(rest || "/").replace(/^\/+/, "");
  return path ? `/${id}/${path}` : `/${id}`;
}
