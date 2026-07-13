import { httpError, validatePublicUserId } from "@/src/lib/utils";

export type OnboardingService = "jobs" | "webetu";
export type OnboardingChannel = "web" | "chat";
export type OnboardingStep =
  | "service_selection"
  | "whatsapp"
  | "connect_google"
  | "job_scout"
  | "whatsapp_chat"
  | "vault"
  | "dashboard";

export function normalizeOnboardingService(value: unknown): OnboardingService {
  const service = String(value ?? "").trim().toLowerCase();
  if (service === "jobs" || service === "webetu") return service;
  throw httpError(400, "service must be jobs or webetu.");
}

export function normalizeOnboardingChannel(value: unknown): OnboardingChannel {
  const channel = String(value ?? "").trim().toLowerCase();
  if (channel === "web" || channel === "chat") return channel;
  throw httpError(400, "channel must be web or chat.");
}

export function storedOnboardingChannel(value: unknown): OnboardingChannel | null {
  return value === "web" || value === "chat" ? value : null;
}

export function calculateOnboardingNextStep(input: {
  selectedService: OnboardingService | null;
  channel?: OnboardingChannel | null;
  whatsappLinked: boolean;
  gmailConnected: boolean;
  jobScoutReady: boolean;
  webetuConfigured: boolean;
}): OnboardingStep {
  if (!input.selectedService) return "service_selection";
  if (!input.whatsappLinked) return "whatsapp";
  if (input.selectedService === "jobs") {
    if (!input.gmailConnected) return "connect_google";
    if (!input.jobScoutReady) return input.channel === "chat" ? "whatsapp_chat" : "job_scout";
    return "dashboard";
  }
  if (!input.webetuConfigured) return "vault";
  return "dashboard";
}

export function scopedPathForOnboardingStep(publicUserIdInput: string, step: OnboardingStep) {
  const publicUserId = validatePublicUserId(publicUserIdInput);
  if (step === "whatsapp") return `/${publicUserId}/whatsapp?onboarding=1`;
  if (step === "connect_google") return `/${publicUserId}/connect-gmail?onboarding=1`;
  if (step === "job_scout") return `/${publicUserId}/job-scout?onboarding=1`;
  if (step === "whatsapp_chat") return `/${publicUserId}/whatsapp?onboarding=1&handoff=1`;
  if (step === "vault") return `/${publicUserId}/vault?onboarding=1`;
  if (step === "service_selection") return `/${publicUserId}/onboarding`;
  return `/${publicUserId}`;
}
