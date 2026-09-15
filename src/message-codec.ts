import { parse, stringify } from "yaml";
import {
  CorruptionError,
  messageId,
  repoAlias,
  roleId,
  sessionId,
  utcTimestamp,
  ValidationError,
} from "./identifiers";
import {
  assertClosed,
  exactObject,
  FORMAT_VERSION,
  INTERRUPTS,
  MESSAGE_KINDS,
  type MessageRecord,
  PRIORITIES,
} from "./protocol";

const FIELDS = [
  "formatVersion",
  "id",
  "from",
  "from_session",
  "to",
  "recipients",
  "repo",
  "kind",
  "priority",
  "interrupt",
  "requires_ack",
  "thread",
  "in_reply_to",
  "deadline",
  "created",
  "paths",
] as const;
const REQUIRED = [
  "formatVersion",
  "id",
  "from",
  "from_session",
  "to",
  "recipients",
  "kind",
  "priority",
  "interrupt",
  "requires_ack",
  "created",
] as const;

export function formatMessage(record: MessageRecord): string {
  const { body: inputBody, ...inputHeader } = record;
  const valid = validateMessage(inputHeader, inputBody);
  const { body, ...header } = valid;
  return `---\n${stringify(header, { lineWidth: 0, sortMapEntries: true }).trimEnd()}\n---\n${normalizeBody(body)}`;
}

export function parseMessage(text: string, path = "<message>"): MessageRecord {
  try {
    if (!text.startsWith("---\n"))
      throw new ValidationError("missing opening frontmatter delimiter");
    const close = text.indexOf("\n---\n", 4);
    if (close < 0)
      throw new ValidationError("missing closing frontmatter delimiter");
    const header = parse(text.slice(4, close), { uniqueKeys: true });
    return validateMessage(header, text.slice(close + 5));
  } catch (error) {
    if (error instanceof CorruptionError) throw error;
    throw new CorruptionError(
      path,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function validateMessage(value: unknown, body: unknown): MessageRecord {
  const o = exactObject(value, FIELDS, REQUIRED, "message");
  if (o.formatVersion !== FORMAT_VERSION)
    throw new ValidationError("unsupported message formatVersion");
  if (typeof body !== "string")
    throw new ValidationError("message body must be text");
  if (!Array.isArray(o.recipients) || o.recipients.length === 0)
    throw new ValidationError("recipients must be non-empty");
  const recipients = o.recipients.map(roleId);
  if (new Set(recipients).size !== recipients.length)
    throw new ValidationError("recipients must be unique");
  const to = o.to === "all" ? "all" : roleId(o.to);
  const optionalString = (name: string): string | undefined => {
    const value = o[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length === 0 || value.length > 512)
      throw new ValidationError(`${name} must be non-empty text`);
    return value;
  };
  const paths =
    o.paths === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(o.paths) ||
            o.paths.some(
              (p) =>
                typeof p !== "string" || p.length > 1024 || p.includes("\0")
            )
          )
            throw new ValidationError("paths must be safe strings");
          return o.paths as string[];
        })();
  if (typeof o.requires_ack !== "boolean")
    throw new ValidationError("requires_ack must be boolean");
  return {
    formatVersion: 1,
    id: messageId(o.id),
    from: roleId(o.from),
    from_session: sessionId(o.from_session),
    to,
    recipients,
    kind: assertClosed(o.kind, MESSAGE_KINDS, "kind"),
    priority: assertClosed(o.priority, PRIORITIES, "priority"),
    interrupt: assertClosed(o.interrupt, INTERRUPTS, "interrupt"),
    requires_ack: o.requires_ack,
    created: utcTimestamp(o.created, "created"),
    body: normalizeBody(body),
    ...(o.repo === undefined ? {} : { repo: repoAlias(o.repo) }),
    ...(optionalString("thread") === undefined
      ? {}
      : { thread: optionalString("thread") }),
    ...(o.in_reply_to === undefined
      ? {}
      : { in_reply_to: messageId(o.in_reply_to) }),
    ...(o.deadline === undefined
      ? {}
      : { deadline: utcTimestamp(o.deadline, "deadline") }),
    ...(paths === undefined ? {} : { paths }),
  };
}

export function normalizeBody(body: string): string {
  return `${body.replace(/\n*$/, "")}\n`;
}
