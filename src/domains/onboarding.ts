import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { httpError, validateFirebaseUid } from "@/src/lib/utils";
import { ensurePublicUserId, getSignedInAccountStatus } from "./users";
import { getJobScoutStatusForUser } from "./job-scout";
import { getWebetuCredentialStatus } from "./webetu";
import {
  calculateOnboardingNextStep,
  normalizeOnboardingChannel,
  normalizeOnboardingService,
  scopedPathForOnboardingStep,
  storedOnboardingChannel,
  type OnboardingChannel,
  type OnboardingService,
} from "./onboarding-flow";
import {
  createAccountLinkInvite,
  getAccountLinkStatusForPhone,
  queueJobScoutPhoneDeliveryUpdate,
} from "./account-link";

export {
  calculateOnboardingNextStep,
  normalizeOnboardingChannel,
  normalizeOnboardingService,
  scopedPathForOnboardingStep,
};
export type { OnboardingChannel, OnboardingService, OnboardingStep } from "./onboarding-flow";

function onboardingRequiresAttention(onboarding: any) {
  const status = String(onboarding?.status ?? "").trim();
  return status === "required" || status === "in_progress";
}

async function loadOnboardingDependencies(uid: string, selectedService: OnboardingService | null) {
  const [accountStatus, jobScoutStatus, webetuStatus] = await Promise.all([
    getSignedInAccountStatus(uid).catch(() => null),
    selectedService === "jobs" ? getJobScoutStatusForUser(uid).catch(() => null) : Promise.resolve(null),
    selectedService === "webetu" ? getWebetuCredentialStatus(uid).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    publicUserId: accountStatus?.publicUserId ?? null,
    whatsappLinked: !!accountStatus?.whatsappLinked,
    gmailConnected: !!jobScoutStatus?.gmailConnected,
    jobScoutReady: !!jobScoutStatus?.ready,
    webetuConfigured: !!webetuStatus?.configured,
    plan: accountStatus?.plan ?? null,
    jobScoutStatus,
    webetuStatus,
  };
}

export async function getOnboardingStatus(uidInput: string) {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) throw httpError(404, "User profile not found.");

  const user = userDoc.data() || {};
  const onboarding = user.onboarding || {};
  const rawService = onboarding.selectedService ?? null;
  const selectedService = rawService === "jobs" || rawService === "webetu" ? rawService : null;
  const channel = storedOnboardingChannel(onboarding.channel);
  const whatsappSkipped = Boolean(onboarding.whatsappSkippedAt);
  const dependencies = await loadOnboardingDependencies(uid, selectedService);
  const nextStep = calculateOnboardingNextStep({
    selectedService,
    channel,
    whatsappLinked: dependencies.whatsappLinked,
    whatsappSkipped,
    gmailConnected: dependencies.gmailConnected,
    jobScoutReady: dependencies.jobScoutReady,
    webetuConfigured: dependencies.webetuConfigured,
  });
  const status = String(onboarding.status ?? "not_required");

  return {
    publicUserId: dependencies.publicUserId ?? user.publicUserId ?? null,
    plan: dependencies.plan,
    selectedService,
    channel,
    status,
    whatsappSkipped,
    onboardingRequired: onboardingRequiresAttention(onboarding),
    skipped: status === "skipped",
    completed: status === "completed",
    nextStep,
    requirements: {
      whatsappLinked: dependencies.whatsappLinked,
      gmailConnected: dependencies.gmailConnected,
      jobScoutReady: dependencies.jobScoutReady,
      webetuConfigured: dependencies.webetuConfigured,
    },
    jobScout: dependencies.jobScoutStatus,
    webetu: dependencies.webetuStatus,
  };
}

export async function selectOnboardingService(uidInput: string, serviceInput: unknown) {
  const uid = validateFirebaseUid(uidInput);
  const service = normalizeOnboardingService(serviceInput);
  const db = getFirestoreDb();
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(userRef);
    if (!doc.exists) throw httpError(404, "User profile not found.");
    const data = doc.data() || {};
    const status = String(data.onboarding?.status ?? "");
    if (status === "completed" || status === "skipped") {
      throw httpError(409, "Onboarding is already finished.");
    }
    t.set(userRef, {
      onboarding: {
        selectedService: service,
        status: "in_progress",
        startedAt: data.onboarding?.startedAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return getOnboardingStatus(uid);
}

async function saveOnboardingRouteForUser(
  uidInput: string,
  serviceInput: unknown,
  channelInput: unknown,
) {
  const uid = validateFirebaseUid(uidInput);
  const service = normalizeOnboardingService(serviceInput);
  const channel = normalizeOnboardingChannel(channelInput);
  const db = getFirestoreDb();
  const userRef = db.collection("users").doc(uid);
  const phoneRef = db.collection("phoneLinksByUser").doc(uid);

  await db.runTransaction(async (t) => {
    const [userDoc, phoneDoc] = await Promise.all([t.get(userRef), t.get(phoneRef)]);
    if (!userDoc.exists) throw httpError(404, "User profile not found.");
    const user = userDoc.data() || {};
    const phoneLink = phoneDoc.exists ? phoneDoc.data() || {} : {};
    const existingStatus = String(user.onboarding?.status ?? "required");
    const finished = existingStatus === "completed" || existingStatus === "skipped";
    const now = FieldValue.serverTimestamp();

    t.set(userRef, {
      onboarding: {
        selectedService: service,
        channel,
        status: finished ? existingStatus : "in_progress",
        startedAt: user.onboarding?.startedAt || now,
        updatedAt: now,
      },
      services: {
        [service]: "subscribed",
      },
      updatedAt: now,
    }, { merge: true });

    if (service === "jobs" && phoneDoc.exists && phoneLink.status === "active" && phoneLink.userId === uid) {
      queueJobScoutPhoneDeliveryUpdate(t as any, db, phoneLink);
    }
  });

  return { uid, service, channel };
}

export async function startOrResumeOnboardingForPhone(
  phoneInput: unknown,
  serviceInput: unknown,
  channelInput: unknown,
) {
  const service = normalizeOnboardingService(serviceInput);
  const channel = normalizeOnboardingChannel(channelInput);
  const linkStatus = await getAccountLinkStatusForPhone(String(phoneInput ?? ""));

  if (!linkStatus.linked || !linkStatus.userId) {
    const invite = await createAccountLinkInvite({
      phone: phoneInput,
      purpose: service,
      nextPath: "/onboarding",
      onboardingService: service,
      onboardingChannel: channel,
      supersedePending: true,
    });
    return {
      ok: true,
      linked: false,
      service,
      channel,
      nextStep: "whatsapp",
      ...invite,
    };
  }

  const route = await saveOnboardingRouteForUser(linkStatus.userId, service, channel);
  let publicUserId = linkStatus.publicUserId;
  if (!publicUserId) {
    const db = getFirestoreDb();
    const userDoc = await db.collection("users").doc(route.uid).get();
    publicUserId = await ensurePublicUserId(db, route.uid, userDoc.data()?.publicUserId);
  }
  const status = await getOnboardingStatus(route.uid);
  const nextStep = calculateOnboardingNextStep({
    selectedService: service,
    channel,
    whatsappLinked: status.requirements.whatsappLinked,
    whatsappSkipped: status.whatsappSkipped,
    gmailConnected: status.requirements.gmailConnected,
    jobScoutReady: status.requirements.jobScoutReady,
    webetuConfigured: status.requirements.webetuConfigured,
  });

  return {
    ok: true,
    linked: true,
    service,
    channel,
    publicUserId,
    nextStep,
    nextUrl: scopedPathForOnboardingStep(publicUserId, nextStep),
  };
}

export async function skipOnboardingWhatsApp(uidInput: string) {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  await db.collection("users").doc(uid).set({
    onboarding: {
      whatsappSkippedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return getOnboardingStatus(uid);
}

export async function skipOnboarding(uidInput: string) {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  await db.collection("users").doc(uid).set({
    onboarding: {
      status: "skipped",
      skippedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return getOnboardingStatus(uid);
}

export async function completeOnboarding(uidInput: string) {
  const uid = validateFirebaseUid(uidInput);
  const status = await getOnboardingStatus(uid);
  if (!status.selectedService) throw httpError(400, "Select a service before completing onboarding.");
  if (status.skipped) throw httpError(409, "Onboarding was skipped.");
  if (!status.completed && status.nextStep !== "dashboard") {
    throw httpError(409, "Onboarding requirements are not complete.");
  }

  const db = getFirestoreDb();
  const now = FieldValue.serverTimestamp();
  const payload: Record<string, any> = {
    services: {
      [status.selectedService]: "subscribed",
    },
    updatedAt: now,
  };
  if (!status.completed) {
    payload.onboarding = {
      selectedService: status.selectedService,
      status: "completed",
      completedAt: now,
      updatedAt: now,
    };
  }
  await db.collection("users").doc(uid).set(payload, { merge: true });
  return getOnboardingStatus(uid);
}
