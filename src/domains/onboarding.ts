import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { httpError, validateFirebaseUid } from "@/src/lib/utils";
import { getSignedInAccountStatus } from "./users";
import { getJobScoutStatusForUser } from "./job-scout";
import { getWebetuCredentialStatus } from "./webetu";

export type OnboardingService = "jobs" | "webetu";
export type OnboardingStep = "service_selection" | "whatsapp" | "connect_google" | "job_scout" | "vault" | "dashboard";

export function normalizeOnboardingService(value: unknown): OnboardingService {
  const service = String(value ?? "").trim().toLowerCase();
  if (service === "jobs" || service === "webetu") return service;
  throw httpError(400, "service must be jobs or webetu.");
}

export function calculateOnboardingNextStep(input: {
  selectedService: OnboardingService | null;
  whatsappLinked: boolean;
  gmailConnected: boolean;
  jobScoutReady: boolean;
  webetuConfigured: boolean;
}): OnboardingStep {
  if (!input.selectedService) return "service_selection";
  if (!input.whatsappLinked) return "whatsapp";
  if (input.selectedService === "jobs") {
    if (!input.gmailConnected) return "connect_google";
    if (!input.jobScoutReady) return "job_scout";
    return "dashboard";
  }
  if (!input.webetuConfigured) return "vault";
  return "dashboard";
}

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
  const dependencies = await loadOnboardingDependencies(uid, selectedService);
  const nextStep = calculateOnboardingNextStep({
    selectedService,
    whatsappLinked: dependencies.whatsappLinked,
    gmailConnected: dependencies.gmailConnected,
    jobScoutReady: dependencies.jobScoutReady,
    webetuConfigured: dependencies.webetuConfigured,
  });
  const status = String(onboarding.status ?? "not_required");

  return {
    publicUserId: dependencies.publicUserId ?? user.publicUserId ?? null,
    selectedService,
    status,
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
  if (status.completed) return status;
  if (status.skipped) throw httpError(409, "Onboarding was skipped.");
  if (status.nextStep !== "dashboard") throw httpError(409, "Onboarding requirements are not complete.");

  const db = getFirestoreDb();
  await db.collection("users").doc(uid).set({
    onboarding: {
      selectedService: status.selectedService,
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return getOnboardingStatus(uid);
}
