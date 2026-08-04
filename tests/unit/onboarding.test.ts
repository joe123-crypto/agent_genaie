import assert from "node:assert/strict";
import test from "node:test";
import { calculateOnboardingNextStep } from "@/src/domains/onboarding";

test("Job Scout onboarding only requires connecting Gmail", () => {
  assert.equal(calculateOnboardingNextStep({
    selectedService: null,
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "service_selection");

  // Connecting Gmail is the first (and only) required step, regardless of
  // WhatsApp linking — that step is no longer part of the required signup flow.
  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "connect_google");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: true,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "connect_google");

  // Once Gmail is connected, web users go straight to the dashboard; CV and
  // preferences are completed there rather than gating onboarding.
  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: true,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "dashboard");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: true,
    gmailConnected: true,
    jobScoutReady: true,
    webetuConfigured: false,
  }), "dashboard");
});

test("Chat-originated Job Scout onboarding still hands off to WhatsApp for CV setup", () => {
  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    channel: "chat",
    whatsappLinked: true,
    gmailConnected: true,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "whatsapp_chat");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    channel: "chat",
    whatsappLinked: true,
    gmailConnected: true,
    jobScoutReady: true,
    webetuConfigured: false,
  }), "dashboard");
});

test("Webetu onboarding chooses WhatsApp before credentials vault", () => {
  assert.equal(calculateOnboardingNextStep({
    selectedService: "webetu",
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "whatsapp");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "webetu",
    whatsappLinked: true,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "vault");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "webetu",
    whatsappLinked: true,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: true,
  }), "dashboard");
});
