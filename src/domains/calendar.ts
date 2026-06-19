import crypto from "node:crypto";
import { CALENDAR_EVENTS_URL } from "@/src/config";
import { getValidAccessToken } from "./gmail";
import { httpError } from "@/src/lib/utils";

const DEFAULT_REMINDERS = [
  { method: "popup", minutes: 1440 },
  { method: "popup", minutes: 120 },
] as const;

const BASE32HEX_ALPHABET = "0123456789abcdefghijklmnopqrstuv";

function base32Hex(buffer: Buffer) {
  let output = "";
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32HEX_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32HEX_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function calendarEventId(tokenStoreKey: string, sourceId: string) {
  const digest = crypto.createHash("sha1").update(`${tokenStoreKey}:${sourceId}`).digest();
  return `es${base32Hex(digest).slice(0, 40)}`;
}

function normalizeDatePart(value: any, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, `event.${field} is required.`);
  }
  if (typeof value.date === "string" && value.date) {
    return { date: value.date };
  }
  if (typeof value.dateTime === "string" && value.dateTime) {
    return {
      dateTime: value.dateTime,
      ...(typeof value.timeZone === "string" && value.timeZone ? { timeZone: value.timeZone } : {}),
    };
  }
  throw httpError(400, `event.${field} must include date or dateTime.`);
}

function normalizeReminders(value: any) {
  const reminders = Array.isArray(value) && value.length > 0 ? value : DEFAULT_REMINDERS;
  return reminders.map((item: any) => {
    const minutes = Number.parseInt(String(item?.minutes ?? ""), 10);
    if (!Number.isFinite(minutes) || minutes < 0) {
      throw httpError(400, "event.reminderOverrides minutes must be a non-negative integer.");
    }
    const method = item?.method === "email" ? "email" : "popup";
    return { method, minutes };
  });
}

function buildDescription(input: any) {
  const description = String(input.description ?? "").trim();
  const sourceUrl = String(input.sourceUrl ?? input.url ?? "").trim();
  if (!sourceUrl || description.includes(sourceUrl)) return description;
  return description ? `${description}\n\nSource: ${sourceUrl}` : sourceUrl;
}

function buildCalendarEvent(tokenStoreKey: string, input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "event is required.");
  }
  const sourceId = String(input.sourceId ?? "").trim();
  const summary = String(input.summary ?? "").trim();
  if (!sourceId) throw httpError(400, "event.sourceId is required.");
  if (!summary) throw httpError(400, "event.summary is required.");

  return {
    id: calendarEventId(tokenStoreKey, sourceId),
    summary,
    ...(input.location ? { location: String(input.location).trim() } : {}),
    ...(input.description || input.sourceUrl || input.url ? { description: buildDescription(input) } : {}),
    start: normalizeDatePart(input.start, "start"),
    end: normalizeDatePart(input.end, "end"),
    reminders: {
      useDefault: false,
      overrides: normalizeReminders(input.reminderOverrides),
    },
  };
}

export async function createCalendarEventForTokenStoreKey(tokenStoreKey: string, input: any) {
  const event = buildCalendarEvent(tokenStoreKey, input);
  const accessToken = await getValidAccessToken(tokenStoreKey);
  const response = await fetch(CALENDAR_EVENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  const result = await response.json().catch(() => ({}));

  if (response.status === 409) {
    return { id: event.id, htmlLink: result.htmlLink ?? null, status: "exists" };
  }
  if (!response.ok) {
    const message = result.error?.message || "Failed to create calendar event";
    if (response.status === 403 && /insufficient|scope|permission/i.test(message)) {
      throw httpError(403, "calendar scope not granted - user must reconnect");
    }
    throw httpError(response.status, message);
  }
  return { id: result.id ?? event.id, htmlLink: result.htmlLink ?? null, status: "created" };
}
