import assert from "node:assert/strict";
import test from "node:test";
import { calculateOnboardingNextStep } from "@/src/domains/onboarding";

test("Job Scout onboarding chooses the first incomplete requirement", () => {
  assert.equal(calculateOnboardingNextStep({
    selectedService: null,
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "service_selection");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: false,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "whatsapp");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: true,
    gmailConnected: false,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "connect_google");

  assert.equal(calculateOnboardingNextStep({
    selectedService: "jobs",
    whatsappLinked: true,
    gmailConnected: true,
    jobScoutReady: false,
    webetuConfigured: false,
  }), "job_scout");

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
