import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export const WEBETU_FALLBACK_RESTAURANT = Object.freeze({
  catalogId: "bab-ezzouar-03",
  name: "الإقامة الجامعية 03 باب الزوار",
  idDepot: 190,
  residence: 5185801,
  wilaya: null,
  active: true,
});

export function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

export function escapeHtmlAttribute(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function rejectHeaderInjection(value: unknown, field: string) {
  const text = String(value ?? "");
  if (/[\r\n]/.test(text)) throw httpError(400, `${field} cannot contain line breaks.`);
  return text.trim();
}

export function validateFirebaseUid(uid: unknown) {
  const value = String(uid ?? "");
  if (!value || value.length > 128) {
    throw httpError(401, "A valid Firebase user is required.");
  }
  return value;
}

export function normalizePhone(value: unknown) {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) throw httpError(400, "phone is required.");
  const phone = `+${digits}`;
  if (phone.length < 9 || phone.length > 16) throw httpError(400, "phone must normalize to 9-16 digits.");
  return phone;
}

export function whatsappPhoneHash(phone: string) {
  return crypto.createHash("sha256").update(`whatsapp:${normalizePhone(phone)}`).digest("hex").slice(0, 12);
}

export function maskPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 4)}...${phone.slice(-4)}`;
}

export function isPublicUserId(value: unknown) {
  return /^usr_[A-Za-z0-9_-]{16}$/.test(String(value ?? ""));
}

export function validatePublicUserId(value: unknown) {
  const text = String(value ?? "");
  if (!isPublicUserId(text)) throw httpError(404, "User route not found.");
  return text;
}

export function generatePublicUserId() {
  return `usr_${crypto.randomBytes(12).toString("base64url")}`;
}

export function tokenStoreKeyForUid(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  return `firebase:${crypto.createHash("sha256").update(safeUid).digest("base64url")}`;
}

export function serviceSubscriptionId(userId: string, service: string) {
  return `${validateFirebaseUid(userId)}_${String(service).replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}

export function credentialRefId(userId: string, service: string, purpose: string) {
  return `${String(service).replace(/[^A-Za-z0-9_.-]/g, "_")}_${String(purpose).replace(/[^A-Za-z0-9_.-]/g, "_")}_${validateFirebaseUid(userId)}`;
}

export function webetuCredentialRefId(userId: string) {
  return credentialRefId(userId, "webetu", "username_password");
}

export function jobApplicationId(userId: string, company: string, role: string) {
  const key = [validateFirebaseUid(userId), String(company ?? "").trim().toLowerCase(), String(role ?? "").trim().toLowerCase()].join("\n");
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function normalizeStringList(value: unknown, maxItems = 24) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text.slice(0, 240));
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeLocaleCode(value: unknown, fallback: string) {
  const text = String(value ?? "").replace(/[^A-Za-z]/g, "").toLowerCase();
  return /^[a-z]{2}$/.test(text) ? text : fallback;
}

export function normalizeJobPreferences(input: any = {}) {
  const source = input && typeof input === "object" ? input : {};
  const maxApplications = Number.parseInt(source.maxApplicationsPerRun ?? "1", 10);
  return {
    targetRoles: normalizeStringList(source.targetRoles ?? source.roles),
    locations: normalizeStringList(source.locations),
    country: normalizeLocaleCode(source.country, "dz"),
    language: normalizeLocaleCode(source.language, "fr"),
    qualifications: normalizeStringList(source.qualifications),
    experience: normalizeStringList(source.experience),
    skills: normalizeStringList(source.skills),
    exclusions: normalizeStringList(source.exclusions),
    promptNotes: normalizeStringList(source.promptNotes ?? source.notes, 12),
    autoApply: source.autoApply === true,
    maxApplicationsPerRun: Number.isFinite(maxApplications) ? Math.min(Math.max(maxApplications, 0), 5) : 1,
  };
}

export function normalizeCvFileRef(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) throw httpError(400, "cvFileRef is required.");
  if (text.length > 500) throw httpError(400, "cvFileRef is too long.");
  if (text.includes("\0")) throw httpError(400, "cvFileRef is invalid.");
  return text;
}

export function normalizeWebetuCredentials(input: any = {}) {
  const username = rejectHeaderInjection(input.username, "username");
  const password = String(input.password ?? "");
  if (!username) throw httpError(400, "username is required.");
  if (username.length > 120) throw httpError(400, "username is too long.");
  if (!password) throw httpError(400, "password is required.");
  if (password.length > 256) throw httpError(400, "password is too long.");
  if (password.includes("\0")) throw httpError(400, "password is invalid.");
  return { username, password };
}

export function normalizeRestaurantLookup(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeRestaurantDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, "date must be YYYY-MM-DD.");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw httpError(400, "date must be a valid calendar date.");
  }
  return text;
}

export function webetuRestaurantOverrideId(userId: string, date: string) {
  return `${validateFirebaseUid(userId)}_${normalizeRestaurantDate(date)}`;
}

export function builtInWebetuRestaurants() {
  return [WEBETU_FALLBACK_RESTAURANT];
}

export function publicRestaurantFields(entry: any) {
  if (!entry) return null;
  const name = entry.name ?? entry.nameAR ?? entry.nameFR ?? "";
  return {
    catalogId: entry.catalogId ?? null,
    name,
    nameAR: entry.nameAR ?? null,
    nameFR: entry.nameFR ?? null,
    breakfast: entry.breakfast == null ? null : Boolean(entry.breakfast),
    lunch: entry.lunch == null ? null : Boolean(entry.lunch),
    dinner: entry.dinner == null ? null : Boolean(entry.dinner),
  };
}

export function storedRestaurantFields(entry: any, source = "catalog") {
  if (!entry || !entry.name || !entry.idDepot) throw httpError(400, "Restaurant entry is incomplete.");
  return {
    catalogId: entry.catalogId ?? `onou-depot-${Number(entry.idDepot)}`,
    name: entry.name,
    nameAR: entry.nameAR ?? null,
    nameFR: entry.nameFR ?? null,
    idDepot: Number(entry.idDepot),
    residence: entry.residence == null ? null : Number(entry.residence),
    wilaya: entry.wilaya == null ? null : String(entry.wilaya),
    breakfast: entry.breakfast == null ? null : Boolean(entry.breakfast),
    lunch: entry.lunch == null ? null : Boolean(entry.lunch),
    dinner: entry.dinner == null ? null : Boolean(entry.dinner),
    source,
    selectedAt: FieldValue.serverTimestamp(),
    lastVerifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function liveWebetuRestaurantFromPayload(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "restaurant must be a supported restaurant object.");
  }
  const idDepot = Number(input.idDepot ?? input.id_depot ?? input.id);
  if (!Number.isInteger(idDepot) || idDepot <= 0) {
    throw httpError(400, "restaurant idDepot is required.");
  }
  const nameAR = String(input.nameAR ?? input.nameAr ?? input.name_ar ?? "").trim();
  const nameFR = String(input.nameFR ?? input.nameFr ?? input.name_fr ?? input.nameEN ?? "").trim();
  const name = String(input.name ?? (nameAR || nameFR)).trim();
  if (!name) throw httpError(400, "restaurant name is required.");
  return {
    catalogId: String(input.catalogId ?? input.catalog_id ?? `onou-depot-${idDepot}`),
    name,
    nameAR: nameAR || name,
    nameFR: nameFR || name,
    idDepot,
    residence: input.residence == null || input.residence === "" ? null : Number(input.residence),
    wilaya: input.wilaya == null || input.wilaya === "" ? null : String(input.wilaya),
    breakfast: input.breakfast == null ? null : Boolean(input.breakfast),
    lunch: input.lunch == null ? null : Boolean(input.lunch),
    dinner: input.dinner == null ? null : Boolean(input.dinner),
    source: String(input.source ?? "onou_getdepotres"),
  };
}

export function splitName(displayName: string | null | undefined) {
  const parts = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function userProfileFromRecord(user: any) {
  const { firstName, lastName } = splitName(user.displayName);
  const googleProvider = user.providerData?.find((entry: any) => entry.providerId === "google.com");
  const providerIds = Array.isArray(user.providerData)
    ? user.providerData.map((entry: any) => entry.providerId).filter(Boolean)
    : [];
  return {
    userId: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
    profile: {
      email: user.email ?? "",
      emailLower: user.email ? String(user.email).trim().toLowerCase() : "",
      emailVerified: Boolean(user.emailVerified),
      displayName: user.displayName ?? null,
      photoUrl: user.photoURL ?? null,
      firstName,
      lastName,
    },
    identities: {
      firebaseUid: user.uid,
      googleProviderUid: googleProvider?.uid ?? null,
      providerIds,
    },
  };
}

export function isGoogleSignIn(decodedToken: any) {
  return decodedToken?.firebase?.sign_in_provider === "google.com";
}

export function serviceStatusWith(existing: any, overrides: any = {}) {
  return {
    gmail: overrides.gmail ?? existing?.gmail ?? "not_connected",
    jobs: overrides.jobs ?? existing?.jobs ?? "not_subscribed",
    webetu: overrides.webetu ?? existing?.webetu ?? "not_subscribed",
    news: overrides.news ?? existing?.news ?? "not_subscribed",
  };
}

export function dateFromFirestore(value: any) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function firestoreTimestampToIso(value: any) {
  return dateFromFirestore(value)?.toISOString() ?? null;
}

export function pendingCacheEntryIsUsable(entry: any, nowMs = Date.now()) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.setupUrl !== "string" || !entry.setupUrl.trim()) return false;
  const expiresAt = new Date(entry.expiresAt ?? "");
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > nowMs;
}

export function pendingCacheEntryMatches(entry: any, criteria: any) {
  if (!entry || typeof entry !== "object") return false;
  if (criteria.phone && entry.phone !== normalizePhone(criteria.phone)) return false;
  if (criteria.phoneHash && entry.phoneHash !== criteria.phoneHash) return false;
  if (criteria.service && entry.service !== criteria.service) return false;
  if (criteria.purpose && entry.purpose !== criteria.purpose) return false;
  if (criteria.nextPath && entry.nextPath !== criteria.nextPath) return false;
  return true;
}

export function normalizeAccountLinkPurpose(value: unknown) {
  const purpose = String(value ?? "account").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40);
  if (!purpose) return "account";
  return purpose;
}

export function normalizeAccountLinkNextPath(value: unknown) {
  const text = String(value ?? "/").trim();
  if (!text || !text.startsWith("/") || text.startsWith("//")) return "/";
  if (text === "/" || text === "/connect-gmail" || text === "/vault" || text === "/whatsapp" || text === "/onboarding") return text;
  const match = text.match(/^\/(connect-gmail|vault|whatsapp|onboarding)\/?(\?.*)?$/);
  if (match) return `/${match[1]}${match[2] ?? ""}`;
  return "/";
}

export function scopedPathForAccountLink(nextPath: string, publicUserId: string) {
  const id = validatePublicUserId(publicUserId);
  const normalized = normalizeAccountLinkNextPath(nextPath);
  if (normalized === "/") return `/${id}`;
  if (normalized === "/connect-gmail") return `/${id}/connect-gmail`;
  if (normalized === "/vault") return `/${id}/vault`;
  if (normalized === "/whatsapp") return `/${id}/whatsapp`;
  if (normalized === "/onboarding") return `/${id}/onboarding`;
  return `/${id}`;
}

export function isActivePhoneLink(data: any) {
  return Boolean(data?.userId) && data.status !== "revoked" && !data.revokedAt;
}

export function setupPurposeLabel(purpose: string) {
  const normalized = normalizeAccountLinkPurpose(purpose);
  if (normalized === "webetu") return "Webetu meal reservations";
  if (normalized === "jobs") return "Job Scout";
  if (normalized === "news") return "Personalized news";
  if (normalized === "account") return "Account link";
  return normalized.replace(/[_-]+/g, " ");
}

export function encodeHeader(value: string) {
  const text = rejectHeaderInjection(value, "Header");
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

export function buildAddressHeader(value: any, field: string) {
  if (Array.isArray(value)) {
    return value.map((entry) => rejectHeaderInjection(entry, field)).filter(Boolean).join(", ");
  }
  return rejectHeaderInjection(value, field);
}

export function encodeBodyPart(text: string, contentType: string) {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(String(text), "utf8").toString("base64"),
  ].join("\r\n");
}

export function wrapBase64(value: string) {
  return String(value).replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
}

export function escapeMimeParam(value: string) {
  return rejectHeaderInjection(value, "MIME parameter").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function normalizeAttachments(input: any) {
  if (input.attachments == null) return [];
  if (!Array.isArray(input.attachments)) throw httpError(400, "attachments must be an array.");
  return input.attachments.map((attachment: any, index: number) => {
    const filename = rejectHeaderInjection(attachment?.filename, `attachments[${index}].filename`);
    if (!filename) throw httpError(400, `attachments[${index}].filename is required.`);
    const contentBase64 = String(attachment?.contentBase64 ?? "").replace(/\s+/g, "");
    if (!contentBase64) throw httpError(400, `attachments[${index}].contentBase64 is required.`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw httpError(400, `attachments[${index}].contentBase64 must be base64.`);
    }
    const contentType = rejectHeaderInjection(attachment?.contentType ?? "application/octet-stream", "contentType");
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(contentType)) {
      throw httpError(400, `attachments[${index}].contentType is invalid.`);
    }
    return { filename, contentType, contentBase64 };
  });
}

export function encodeAttachmentPart(attachment: any) {
  const filename = escapeMimeParam(attachment.filename);
  return [
    `Content-Type: ${attachment.contentType}; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    wrapBase64(attachment.contentBase64),
  ].join("\r\n");
}

export function buildBodyMimePart(text: string, html: string) {
  if (text && html) {
    const boundary = `gmail_alt_${crypto.randomBytes(12).toString("hex")}`;
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      encodeBodyPart(text, "text/plain"),
      `--${boundary}`,
      encodeBodyPart(html, "text/html"),
      `--${boundary}--`,
    ].join("\r\n");
  }
  return encodeBodyPart(html || text, html ? "text/html" : "text/plain");
}

export function buildMimeMessage(input: any) {
  const to = buildAddressHeader(input.to, "to");
  if (!to) throw httpError(400, "to is required.");
  const subject = encodeHeader(input.subject ?? "");
  const text = input.text == null ? "" : String(input.text);
  const html = input.html == null ? "" : String(input.html);
  if (!text && !html) throw httpError(400, "text or html is required.");
  const attachments = normalizeAttachments(input);

  const headers = [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0"];
  if (input.cc) headers.push(`Cc: ${buildAddressHeader(input.cc, "cc")}`);
  if (input.bcc) headers.push(`Bcc: ${buildAddressHeader(input.bcc, "bcc")}`);
  if (input.replyTo) headers.push(`Reply-To: ${buildAddressHeader(input.replyTo, "replyTo")}`);

  if (attachments.length > 0) {
    const boundary = `gmail_mixed_${crypto.randomBytes(12).toString("hex")}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    return [
      ...headers,
      "",
      `--${boundary}`,
      buildBodyMimePart(text, html),
      ...attachments.flatMap((attachment: any) => [`--${boundary}`, encodeAttachmentPart(attachment)]),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  if (text && html) {
    const boundary = `gmail_alt_${crypto.randomBytes(12).toString("hex")}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    return [
      ...headers,
      "",
      `--${boundary}`,
      encodeBodyPart(text, "text/plain"),
      `--${boundary}`,
      encodeBodyPart(html, "text/html"),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  headers.push(`Content-Type: ${html ? "text/html" : "text/plain"}; charset=UTF-8`);
  headers.push("Content-Transfer-Encoding: base64");
  return [...headers, "", Buffer.from(html || text, "utf8").toString("base64"), ""].join("\r\n");
}

export function encodeGmailRawMessage(input: any) {
  return Buffer.from(buildMimeMessage(input), "utf8").toString("base64url");
}
