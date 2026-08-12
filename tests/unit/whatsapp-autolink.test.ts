import assert from "node:assert/strict";
import test from "node:test";
import { decideWhatsAppAutoLink } from "@/src/domains/whatsapp-autolink";

const INVITE_HASH = "abc123def456";

test("auto-binds when the user has no active phone link (first-time signup)", () => {
  assert.deepEqual(decideWhatsAppAutoLink(null, INVITE_HASH), { kind: "auto-bind" });
  assert.deepEqual(
    decideWhatsAppAutoLink({ whatsappLinked: false, phoneHash: null }, INVITE_HASH),
    { kind: "auto-bind" },
  );
  // A stale hash without an active link must not force a confirm step.
  assert.deepEqual(
    decideWhatsAppAutoLink({ whatsappLinked: false, phoneHash: "otherhash000" }, INVITE_HASH),
    { kind: "auto-bind" },
  );
});

test("auto-binds when the same number is already linked (satisfied)", () => {
  assert.deepEqual(
    decideWhatsAppAutoLink({ whatsappLinked: true, phoneHash: INVITE_HASH }, INVITE_HASH),
    { kind: "auto-bind" },
  );
});

test("requires confirm-to-replace when an active link is on a different number", () => {
  assert.deepEqual(
    decideWhatsAppAutoLink({ whatsappLinked: true, phoneHash: "differenthash" }, INVITE_HASH),
    { kind: "confirm-replace" },
  );
});
