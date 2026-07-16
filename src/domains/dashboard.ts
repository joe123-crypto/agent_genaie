import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import {
  httpError,
  isActivePhoneLink,
  normalizePhone,
  validateFirebaseUid,
  whatsappPhoneHash,
} from "@/src/lib/utils";

export type DashboardTaskId = "reserve_meals" | "search_apply_jobs" | "deliver_results";
export type DashboardTaskService = "webetu" | "job_scout" | "delivery";
export type DashboardTaskStatus = "active" | "running" | "paused" | "failed" | "disabled";
export type DashboardLastRunStatus = "success" | "partial" | "failed" | "skipped" | "action_required";

export type DashboardTaskSnapshot = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: DashboardLastRunStatus | null;
  lastRunSummary: string | null;
  nextRunAt: string | null;
  scheduleLabel: string | null;
  service: DashboardTaskService;
  status: DashboardTaskStatus;
  taskId: DashboardTaskId;
  timezone: string | null;
  updatedAt: string | null;
};

const taskIds = new Set(["reserve_meals", "search_apply_jobs", "deliver_results"]);
const services = new Set(["webetu", "job_scout", "delivery"]);
const statuses = new Set(["active", "running", "paused", "failed", "disabled"]);
const lastRunStatuses = new Set(["success", "partial", "failed", "skipped", "action_required"]);

function dashboardTaskStatusId(userId: string, taskId: DashboardTaskId) {
  return `${validateFirebaseUid(userId)}_${taskId}`;
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<string>, field: string): T {
  const text = String(value ?? "").trim();
  if (!allowed.has(text)) throw httpError(400, `${field} is invalid.`);
  return text as T;
}

function normalizeOptionalDate(value: unknown, field: string) {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw httpError(400, `${field} must be an ISO date.`);
  return date;
}

function normalizeOptionalString(value: unknown, maxLength: number, field: string) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.includes("\0")) throw httpError(400, `${field} is invalid.`);
  return text.slice(0, maxLength);
}

function dateToIso(value: any) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taskMatchesService(taskId: DashboardTaskId, service: DashboardTaskService) {
  return (
    (taskId === "reserve_meals" && service === "webetu")
    || (taskId === "search_apply_jobs" && service === "job_scout")
    || (taskId === "deliver_results" && service === "delivery")
  );
}

async function resolveDashboardUser(body: any) {
  if (body.userId) return validateFirebaseUid(body.userId);
  if (!body.phone) throw httpError(400, "userId or phone is required.");

  const phone = normalizePhone(body.phone);
  const hash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const [phoneDoc, webetuDeliveryDoc, jobScoutDeliveryDoc] = await Promise.all([
    db.collection("phoneLinksByPhone").doc(hash).get(),
    db.collection("webetuDeliveryByPhone").doc(hash).get(),
    db.collection("jobScoutDeliveryByPhone").doc(hash).get(),
  ]);

  for (const doc of [phoneDoc, webetuDeliveryDoc, jobScoutDeliveryDoc]) {
    const data = doc.exists ? doc.data() || {} : {};
    if (isActivePhoneLink(data) && data.userId) return validateFirebaseUid(data.userId);
    if (data.status === "active" && data.userId) return validateFirebaseUid(data.userId);
  }

  throw httpError(404, "Linked dashboard user not found.");
}

function taskSnapshotFromData(data: any): DashboardTaskSnapshot | null {
  const taskId = String(data?.taskId ?? "");
  const service = String(data?.service ?? "");
  const status = String(data?.status ?? "");
  if (!taskIds.has(taskId) || !services.has(service) || !statuses.has(status)) return null;
  return {
    enabled: data.enabled !== false,
    lastRunAt: dateToIso(data.lastRunAt),
    lastRunStatus: lastRunStatuses.has(String(data.lastRunStatus ?? "")) ? data.lastRunStatus : null,
    lastRunSummary: typeof data.lastRunSummary === "string" ? data.lastRunSummary : null,
    nextRunAt: dateToIso(data.nextRunAt),
    scheduleLabel: typeof data.scheduleLabel === "string" ? data.scheduleLabel : null,
    service: service as DashboardTaskService,
    status: status as DashboardTaskStatus,
    taskId: taskId as DashboardTaskId,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
    updatedAt: dateToIso(data.updatedAt),
  };
}

export async function listDashboardTasksForUser(userIdInput: string) {
  const userId = validateFirebaseUid(userIdInput);
  const snap = await getFirestoreDb()
    .collection("dashboardTaskStatus")
    .where("userId", "==", userId)
    .get();
  const tasks = snap.docs
    .map((doc) => taskSnapshotFromData(doc.data()))
    .filter((task): task is DashboardTaskSnapshot => Boolean(task));
  return { tasks };
}

export async function upsertDashboardTaskStatus(body: any) {
  const userId = await resolveDashboardUser(body);
  const taskId = normalizeEnum<DashboardTaskId>(body.taskId, taskIds, "taskId");
  const service = normalizeEnum<DashboardTaskService>(body.service, services, "service");
  if (!taskMatchesService(taskId, service)) throw httpError(400, "service does not match taskId.");

  const status = normalizeEnum<DashboardTaskStatus>(body.status ?? "active", statuses, "status");
  const lastRunStatus = body.lastRunStatus == null || body.lastRunStatus === ""
    ? null
    : normalizeEnum<DashboardLastRunStatus>(body.lastRunStatus, lastRunStatuses, "lastRunStatus");
  const nextRunAt = normalizeOptionalDate(body.nextRunAt, "nextRunAt");
  const lastRunAt = normalizeOptionalDate(body.lastRunAt, "lastRunAt");
  const scheduleLabel = normalizeOptionalString(body.scheduleLabel, 160, "scheduleLabel");
  const timezone = normalizeOptionalString(body.timezone, 80, "timezone");
  const lastRunSummary = normalizeOptionalString(body.lastRunSummary, 240, "lastRunSummary");
  const enabled = body.enabled === false ? false : true;

  const payload = {
    userId,
    taskId,
    service,
    enabled,
    status,
    scheduleLabel,
    timezone,
    nextRunAt,
    lastRunAt,
    lastRunStatus,
    lastRunSummary,
    source: "agent",
    updatedAt: FieldValue.serverTimestamp(),
  };
  await getFirestoreDb()
    .collection("dashboardTaskStatus")
    .doc(dashboardTaskStatusId(userId, taskId))
    .set(payload, { merge: true });
  return { ok: true, userId, taskId };
}
