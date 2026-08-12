// Pure decision helper for the WhatsApp token/invite page. Kept free of
// firebase-admin imports so it can be unit-tested in isolation.

export type WhatsAppAutoLinkDecision =
  | { kind: "auto-bind" }
  | { kind: "confirm-replace" };

export type ExistingPhoneLinkSummary = {
  whatsappLinked?: boolean;
  // Truncated (12-char) phone hash as returned by getWhatsAppLinkForUser.
  phoneHash?: string | null;
} | null | undefined;

// Decides how a signed-in user hitting /whatsapp?token=... should be handled:
//   - No active phone link (first-time signup) -> auto-bind silently.
//   - Active link on the *same* number -> already satisfied, auto-bind is a no-op
//     the bind guard accepts, so still auto-bind and continue.
//   - Active link on a *different* number (changing number) -> require an explicit
//     confirm-to-replace step; the bind guard rejects a silent replace.
// Both hashes must already be truncated the same way before being passed in.
export function decideWhatsAppAutoLink(
  existingLink: ExistingPhoneLinkSummary,
  inviteTruncatedHash: string,
): WhatsAppAutoLinkDecision {
  const hasActiveLink = Boolean(existingLink?.whatsappLinked && existingLink?.phoneHash);
  if (hasActiveLink && existingLink!.phoneHash !== inviteTruncatedHash) {
    return { kind: "confirm-replace" };
  }
  return { kind: "auto-bind" };
}
