import assert from "node:assert/strict";
import test from "node:test";
import { calculateOnboardingNextStep } from "@/src/domains/onboarding";

test("Job Scout onboarding requires Gmail then the Job Scout profile", () => {
  assert.equal(calculateOnboardingNextStep({
    selectedService: null,
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
  }), "service_selection");

  // Connecting Gmail is the first required step, regardless of WhatsApp
  // linking — WhatsApp is no longer part of the signup flow.
  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
  }), "connect_google");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: true,
    gmailConnected: false,
    jobScoutReady: false,
  }), "connect_google");

  // Once Gmail is connected, the Job Scout profile is still required, and an
  // unlinked WhatsApp no longer holds the user back from reaching it.
  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: true,
    jobScoutReady: false,
  }), "job_scout");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: true,
    jobScoutReady: true,
  }), "dashboard");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: true,
    gmailConnected: true,
    jobScoutReady: true,
  }), "dashboard");
});

test("connect_google is an inert fallback once Gmail is connected at sign-in", () => {
  // Google sign-in now grants gmail.send and persists services.gmail=connected,
  // so gmailConnected is true for normal Google users and the connect_google step
  // is skipped. The branch only fires for email-link / non-Google sign-ins that
  // lack the grant (gmailConnected=false), keeping it a fallback rather than a
  // routine step.
  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: true,
    jobScoutReady: false,
  }), "job_scout");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
  }), "connect_google");
});

test("Chat-originated Job Scout onboarding still hands off to WhatsApp for CV setup", () => {
  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    channel: "chat",
    whatsappLinked: true,
    gmailConnected: true,
    jobScoutReady: false,
  }), "whatsapp_chat");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    channel: "chat",
    whatsappLinked: true,
    gmailConnected: true,
    jobScoutReady: true,
  }), "dashboard");
});
