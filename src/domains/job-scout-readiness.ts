export const JOB_SCOUT_ONBOARDING_VERSION = 2;
export const JOB_SCOUT_SAFETY_ACKNOWLEDGEMENT_VERSION = "scam-warning-v1";

export type JobScoutReadinessInput = {
  onboardingVersion?: unknown;
  preferences?: unknown;
  gmailConnected: boolean;
  senderEmail?: unknown;
  cvFileRef?: unknown;
  cvHtmlRef?: unknown;
  cvConversionStatus?: unknown;
  cvAvailable: boolean;
  profileConfirmedAt?: unknown;
  safetyAcknowledgedAt?: unknown;
};

export type JobScoutReadiness = {
  onboardingVersion: number | null;
  legacyProfile: boolean;
  profileConfirmed: boolean;
  safetyAcknowledged: boolean;
  ready: boolean;
  setupStatus: "draft" | "pending" | "ready";
  missingRequirements: string[];
};

function nonEmptyList(value: unknown) {
  return Array.isArray(value) && value.some((item) => String(item ?? "").trim());
}

export function evaluateJobScoutReadiness(input: JobScoutReadinessInput): JobScoutReadiness {
  const parsedVersion = Number(input.onboardingVersion);
  const onboardingVersion = Number.isInteger(parsedVersion) && parsedVersion > 0 ? parsedVersion : null;
  const legacyProfile = onboardingVersion === null || onboardingVersion < JOB_SCOUT_ONBOARDING_VERSION;
  const preferences = input.preferences && typeof input.preferences === "object"
    ? input.preferences as Record<string, unknown>
    : {};
  const hasRoles = nonEmptyList(preferences.targetRoles ?? preferences.roles);
  const hasLocations = nonEmptyList(preferences.locations);
  const hasCountry = /^[a-z]{2}$/i.test(String(preferences.country ?? "").trim());
  const hasSenderEmail = Boolean(String(input.senderEmail ?? "").trim());
  const cvHtmlRef = String(input.cvHtmlRef ?? input.cvFileRef ?? "").trim();
  const conversionStatus = String(input.cvConversionStatus ?? "").trim().toLowerCase();
  const hasReadyCv = Boolean(
    conversionStatus === "ready"
    && cvHtmlRef
    && input.cvAvailable,
  );
  const structurallyComplete = Boolean(
    input.gmailConnected
    && hasSenderEmail
    && hasReadyCv
    && hasRoles
    && hasLocations
    && hasCountry
  );
  const profileConfirmed = legacyProfile ? structurallyComplete : Boolean(input.profileConfirmedAt);
  const safetyAcknowledged = legacyProfile ? structurallyComplete : Boolean(input.safetyAcknowledgedAt);

  // A linked WhatsApp phone is deliberately not a requirement: it only enables
  // chat updates, so the agent runs for users who never link one.
  const missingRequirements: string[] = [];
  if (!input.gmailConnected) missingRequirements.push("gmail_connection");
  if (!hasSenderEmail) missingRequirements.push("sender_email");
  if (!hasReadyCv) {
    missingRequirements.push(conversionStatus === "pending" ? "cv_conversion" : "cv");
  }
  if (!hasRoles) missingRequirements.push("target_roles");
  if (!hasLocations || !hasCountry) missingRequirements.push("locations");
  if (!profileConfirmed) missingRequirements.push("profile_confirmation");
  if (!safetyAcknowledged) missingRequirements.push("safety_acknowledgement");

  const ready = missingRequirements.length === 0;
  return {
    onboardingVersion,
    legacyProfile,
    profileConfirmed,
    safetyAcknowledged,
    ready,
    setupStatus: ready ? "ready" : conversionStatus === "pending" ? "pending" : "draft",
    missingRequirements,
  };
}
