import { ulid } from "ulid";

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type MissionId = Brand<string, "MissionId">;
export type RoleId = Brand<string, "RoleId">;
export type SessionId = Brand<string, "SessionId">;
export type TaskId = Brand<string, "TaskId">;
export type RepoAlias = Brand<string, "RepoAlias">;
export type MessageId = Brand<string, "MessageId">;
export type EventId = Brand<string, "EventId">;

export interface Clock {
  now(): Date;
}
export interface IdGenerator {
  next(): string;
}
export const systemClock: Clock = { now: () => new Date() };
export const ulidGenerator: IdGenerator = { next: () => ulid() };

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function segment<Name extends string>(
  value: unknown,
  label: string
): Brand<string, Name> {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !SEGMENT.test(value) ||
    value === "." ||
    value === ".." ||
    /[. ]$/.test(value)
  ) {
    throw new ValidationError(`${label} must be 1-128 path-safe characters`);
  }
  return value as Brand<string, Name>;
}

export const missionId = (v: unknown) => segment<"MissionId">(v, "mission id");
export const roleId = (v: unknown) => segment<"RoleId">(v, "role");
export const sessionId = (v: unknown) => segment<"SessionId">(v, "session id");
export const taskId = (v: unknown) => segment<"TaskId">(v, "task id");
export const repoAlias = (v: unknown) =>
  segment<"RepoAlias">(v, "repository alias");
export function messageId(v: unknown): MessageId {
  if (typeof v !== "string" || !ULID.test(v))
    throw new ValidationError("message id must be a canonical ULID");
  return v as MessageId;
}
export const eventId = (v: unknown) => messageId(v) as unknown as EventId;
export function utcTimestamp(value: unknown, label = "timestamp"): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ValidationError(`${label} must be an ISO UTC timestamp`);
  }
  return new Date(value).toISOString();
}
export const nowIso = (clock: Clock): string => clock.now().toISOString();

export class ValidationError extends Error {
  readonly code = "INVALID_INPUT";
}
export class CorruptionError extends Error {
  readonly code = "CORRUPT_STATE";
  constructor(
    readonly path: string,
    reason: string
  ) {
    super(`Corrupt protocol record at ${path}: ${reason}`);
  }
}
