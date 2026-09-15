import { parse, stringify } from "yaml";
import {
  CorruptionError,
  eventId,
  messageId,
  roleId,
  sessionId,
  utcTimestamp,
  ValidationError,
} from "./identifiers";
import {
  assertClosed,
  exactObject,
  FORMAT_VERSION,
  RECEIPT_EVENTS,
  type ReceiptRecord,
} from "./protocol";

const FIELDS = [
  "formatVersion",
  "id",
  "message",
  "agent",
  "session",
  "event",
  "created",
  "note",
  "delegated_to",
] as const;
export function formatReceipt(record: ReceiptRecord): string {
  return stringify(validateReceipt(record), {
    lineWidth: 0,
    sortMapEntries: true,
  });
}
export function parseReceipt(text: string, path = "<receipt>"): ReceiptRecord {
  try {
    return validateReceipt(parse(text, { uniqueKeys: true }));
  } catch (error) {
    throw new CorruptionError(
      path,
      error instanceof Error ? error.message : String(error)
    );
  }
}
export function validateReceipt(value: unknown): ReceiptRecord {
  const o = exactObject(
    value,
    FIELDS,
    ["formatVersion", "id", "message", "agent", "session", "event", "created"],
    "receipt"
  );
  if (o.formatVersion !== FORMAT_VERSION)
    throw new ValidationError("unsupported receipt formatVersion");
  const note =
    o.note === undefined
      ? undefined
      : typeof o.note === "string" && o.note.length <= 4096
        ? o.note
        : (() => {
            throw new ValidationError("invalid receipt note");
          })();
  return {
    formatVersion: 1,
    id: eventId(o.id),
    message: messageId(o.message),
    agent: roleId(o.agent),
    session: sessionId(o.session),
    event: assertClosed(o.event, RECEIPT_EVENTS, "event"),
    created: utcTimestamp(o.created),
    ...(note === undefined ? {} : { note }),
    ...(o.delegated_to === undefined
      ? {}
      : { delegated_to: roleId(o.delegated_to) }),
  };
}
