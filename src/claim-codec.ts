import { parse, stringify } from "yaml";
import {
  CorruptionError,
  messageId,
  roleId,
  sessionId,
  taskId,
  utcTimestamp,
  ValidationError,
} from "./identifiers";
import { type ClaimRecord, exactObject, FORMAT_VERSION } from "./protocol";

const FIELDS = [
  "formatVersion",
  "task",
  "message",
  "agent",
  "session",
  "status",
  "version",
  "expires",
  "created",
  "updated",
  "observed_prior_version",
  "note",
] as const;
export function formatClaim(record: ClaimRecord): string {
  return stringify(validateClaim(record), {
    lineWidth: 0,
    sortMapEntries: true,
  });
}
export function parseClaim(text: string, path = "<claim>"): ClaimRecord {
  try {
    return validateClaim(parse(text, { uniqueKeys: true }));
  } catch (error) {
    throw new CorruptionError(
      path,
      error instanceof Error ? error.message : String(error)
    );
  }
}
export function validateClaim(value: unknown): ClaimRecord {
  const o = exactObject(
    value,
    FIELDS,
    [
      "formatVersion",
      "task",
      "agent",
      "session",
      "status",
      "version",
      "expires",
      "created",
      "updated",
    ],
    "claim"
  );
  if (
    o.formatVersion !== FORMAT_VERSION ||
    (o.status !== "claimed" && o.status !== "released") ||
    !Number.isInteger(o.version) ||
    (o.version as number) < 1
  )
    throw new ValidationError("invalid claim header");
  if (
    o.observed_prior_version !== undefined &&
    (!Number.isInteger(o.observed_prior_version) ||
      (o.observed_prior_version as number) < 1)
  )
    throw new ValidationError("invalid observed prior version");
  if (
    o.note !== undefined &&
    (typeof o.note !== "string" || o.note.length > 4096)
  )
    throw new ValidationError("invalid claim note");
  return {
    formatVersion: 1,
    task: taskId(o.task),
    agent: roleId(o.agent),
    session: sessionId(o.session),
    status: o.status,
    version: o.version as number,
    expires: utcTimestamp(o.expires, "expires"),
    created: utcTimestamp(o.created, "created"),
    updated: utcTimestamp(o.updated, "updated"),
    ...(o.message === undefined ? {} : { message: messageId(o.message) }),
    ...(o.observed_prior_version === undefined
      ? {}
      : { observed_prior_version: o.observed_prior_version as number }),
    ...(o.note === undefined ? {} : { note: o.note as string }),
  };
}
