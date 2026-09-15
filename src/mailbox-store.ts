import { dirname } from "node:path";
import { publishImmutable, replaceMutable } from "./atomic-files";
import type { FileSystem } from "./filesystem";
import { isMissing } from "./filesystem";
import type { Clock, IdGenerator, MessageId, RoleId } from "./identifiers";
import {
  CorruptionError,
  messageId,
  nowIso,
  roleId,
  sessionId,
  utcTimestamp,
  ValidationError,
} from "./identifiers";
import { formatJson, parseJson } from "./json-codec";
import { formatMessage, parseMessage } from "./message-codec";
import type { MissionSnapshot } from "./mission";
import { resolveRecipients, validateRepo } from "./mission";
import { KeyedMutex } from "./mutex";
import {
  type AckInput,
  assertClosed,
  type CursorRecord,
  type DeliveryMarker,
  exactObject,
  FORMAT_VERSION,
  INTERRUPTS,
  MESSAGE_KINDS,
  type MessageRecord,
  PRIORITIES,
  RECEIPT_EVENTS,
  type ReadInput,
  type ReceiptRecord,
  type ReplyInput,
  type SendInput,
  type TrustedIdentity,
} from "./protocol";
import { formatReceipt, parseReceipt } from "./receipt-codec";
import { ensureProtocolDirectory } from "./safe-path";

export interface MailboxLimits {
  messageMaxBytes: number;
  readLimit: number;
  readMaxBytes: number;
}
export interface SendResult {
  message: MessageRecord;
  delivered: RoleId[];
  incomplete: RoleId[];
}
export interface ReadResult {
  messages: MessageRecord[];
  truncated: boolean;
  remaining: number;
}

export class MailboxStore {
  constructor(
    readonly fs: FileSystem,
    readonly mission: MissionSnapshot,
    readonly clock: Clock,
    readonly ids: IdGenerator,
    readonly limits: MailboxLimits,
    readonly mutex = new KeyedMutex()
  ) {}

  async send(identity: TrustedIdentity, input: SendInput): Promise<SendResult> {
    return this.createAndPublish(identity, input);
  }

  async reconcile(role?: RoleId): Promise<RoleId[]> {
    const repaired = new Set<RoleId>();
    await ensureProtocolDirectory(
      this.fs,
      this.mission.paths.root,
      this.mission.paths.messages()
    );
    let names: string[];
    try {
      names = await this.fs.readdir(this.mission.paths.messages());
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
      const id = messageId(name.slice(0, -3));
      const record = await this.loadMessage(id);
      for (const recipient of record.recipients) {
        if (role && recipient !== role) continue;
        try {
          const result = await this.publishMarker(record, recipient);
          if (result) repaired.add(recipient);
        } catch {
          /* caller can retry; canonical message remains truth */
        }
      }
    }
    return [...repaired].sort();
  }

  async read(
    identity: TrustedIdentity,
    input: ReadInput = {}
  ): Promise<ReadResult> {
    return this.mutex.run(
      `cursor:${identity.role}:${identity.session}`,
      async () => {
        await this.reconcile(identity.role);
        await ensureProtocolDirectory(
          this.fs,
          this.mission.paths.root,
          this.mission.paths.inbox(identity.role)
        );
        const markerNames = (
          await this.fs.readdir(this.mission.paths.inbox(identity.role))
        )
          .filter((name) => name.endsWith(".json"))
          .sort();
        const markers: DeliveryMarker[] = [];
        for (const name of markerNames) {
          const id = messageId(name.slice(0, -5));
          const path = this.mission.paths.marker(identity.role, id);
          const marker = parseJson(
            (await this.fs.readFile(path)).toString("utf8"),
            path,
            validateMarker
          );
          if (marker.message !== id || marker.recipient !== identity.role)
            throw new CorruptionError(
              path,
              "delivery marker identity does not match its path"
            );
          markers.push(marker);
        }
        const allIds = markers.map((marker) => marker.message);
        const cursor = await this.readCursor(identity);
        const returned = new Set(cursor?.returned ?? []);
        const since = input.since
          ? Date.parse(utcTimestamp(input.since, "since"))
          : undefined;
        const eligible = markers
          .filter(
            (marker) =>
              (input.replay || !returned.has(marker.message)) &&
              (since === undefined || Date.parse(marker.created) >= since)
          )
          .sort(
            (a, b) =>
              a.created.localeCompare(b.created) ||
              a.message.localeCompare(b.message)
          );
        const limit = Math.min(
          Math.max(input.limit ?? this.limits.readLimit, 1),
          this.limits.readLimit
        );
        const maxBytes = Math.min(
          Math.max(input.maxBytes ?? this.limits.readMaxBytes, 1024),
          this.limits.readMaxBytes
        );
        const selected: MessageRecord[] = [];
        let bytes = 0;
        for (const marker of eligible) {
          if (selected.length >= limit) break;
          const record = await this.loadMessage(marker.message);
          if (record.created !== marker.created)
            throw new CorruptionError(
              this.mission.paths.marker(identity.role, marker.message),
              `timestamp does not match message ${record.id}`
            );
          const size = Buffer.byteLength(formatMessage(record));
          if (selected.length > 0 && bytes + size > maxBytes) break;
          if (size > maxBytes && selected.length === 0)
            throw new ValidationError(
              `Message ${record.id} exceeds read output limit`
            );
          selected.push(record);
          bytes += size;
        }
        if (!input.replay) {
          for (const record of selected) returned.add(record.id);
          await this.writeCursor(
            identity,
            [...returned].filter((id) => allIds.includes(id)).sort()
          );
        }
        return {
          messages: selected,
          truncated: selected.length < eligible.length,
          remaining: eligible.length - selected.length,
        };
      }
    );
  }

  async acknowledge(
    identity: TrustedIdentity,
    input: AckInput
  ): Promise<ReceiptRecord> {
    const message = await this.loadMessage(messageId(input.message));
    if (!message.recipients.includes(identity.role))
      throw new ValidationError("Bound role is not a message recipient");
    const created = nowIso(this.clock);
    const id = messageId(this.ids.next()) as unknown as ReceiptRecord["id"];
    const delegatedTo =
      input.delegated_to === undefined ? undefined : roleId(input.delegated_to);
    if (delegatedTo && !this.mission.roles.includes(delegatedTo))
      throw new ValidationError(`Unknown delegated role: ${delegatedTo}`);
    const record: ReceiptRecord = {
      formatVersion: 1,
      id,
      message: message.id,
      agent: identity.role,
      session: identity.session,
      event: assertClosed(input.event, RECEIPT_EVENTS, "receipt event"),
      created,
      ...(input.note === undefined
        ? {}
        : { note: limited(input.note, "note", 4096) }),
      ...(delegatedTo === undefined ? {} : { delegated_to: delegatedTo }),
    };
    await ensureProtocolDirectory(
      this.fs,
      this.mission.paths.root,
      this.mission.paths.receipts(message.id)
    );
    const stamp = created.replace(/[-:.]/g, "");
    const filename = `${stamp}_${identity.role}_${identity.session}_${id}.yaml`;
    await publishImmutable(
      this.fs,
      this.mission.paths.receipt(message.id, filename),
      Buffer.from(formatReceipt(record))
    );
    return record;
  }

  async receipts(idInput: string): Promise<ReceiptRecord[]> {
    const id = messageId(idInput);
    const dir = this.mission.paths.receipts(id);
    let names: string[];
    try {
      names = await this.fs.readdir(dir);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const records = await Promise.all(
      names
        .filter((n) => n.endsWith(".yaml"))
        .map(async (name) =>
          parseReceipt(
            (
              await this.fs.readFile(this.mission.paths.receipt(id, name))
            ).toString("utf8"),
            this.mission.paths.receipt(id, name)
          )
        )
    );
    return records.sort(
      (a, b) =>
        a.created.localeCompare(b.created) ||
        String(a.id).localeCompare(String(b.id))
    );
  }

  async reply(
    identity: TrustedIdentity,
    input: ReplyInput
  ): Promise<SendResult> {
    const original = await this.loadMessage(messageId(input.message));
    if (!original.recipients.includes(identity.role))
      throw new ValidationError("Bound role is not a message recipient");
    return this.createAndPublish(
      identity,
      {
        to: original.from,
        body: input.body,
        kind: "update",
        priority: input.priority ?? original.priority,
        interrupt: input.interrupt ?? original.interrupt,
        thread: original.thread ?? original.id,
      },
      original.id
    );
  }

  async loadMessage(id: MessageId): Promise<MessageRecord> {
    const path = this.mission.paths.message(id);
    return parseMessage((await this.fs.readFile(path)).toString("utf8"), path);
  }

  private async createAndPublish(
    identity: TrustedIdentity,
    input: SendInput,
    inReplyTo?: MessageId
  ): Promise<SendResult> {
    const routing = resolveRecipients(this.mission, identity.role, input.to);
    if (routing.recipients.length === 0)
      throw new ValidationError("No recipients resolved");
    if (Buffer.byteLength(input.body) > this.limits.messageMaxBytes)
      throw new ValidationError(
        `Message body exceeds ${this.limits.messageMaxBytes} bytes`
      );
    const created = nowIso(this.clock);
    const id = messageId(this.ids.next());
    const repo = validateRepo(this.mission, input.repo);
    const message: MessageRecord = {
      formatVersion: FORMAT_VERSION,
      id,
      from: identity.role,
      from_session: identity.session,
      ...routing,
      kind: assertClosed(input.kind ?? "request", MESSAGE_KINDS, "kind"),
      priority: assertClosed(input.priority ?? "P2", PRIORITIES, "priority"),
      interrupt: assertClosed(
        input.interrupt ?? "task-boundary",
        INTERRUPTS,
        "interrupt"
      ),
      requires_ack: input.requires_ack ?? false,
      created,
      body: input.body,
      ...(repo ? { repo } : {}),
      ...(input.thread ? { thread: limited(input.thread, "thread", 512) } : {}),
      ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
      ...(input.deadline
        ? { deadline: utcTimestamp(input.deadline, "deadline") }
        : {}),
      ...(input.paths
        ? { paths: input.paths.map((p) => limited(p, "path", 1024)) }
        : {}),
    };
    await ensureProtocolDirectory(
      this.fs,
      this.mission.paths.root,
      this.mission.paths.messages()
    );
    await publishImmutable(
      this.fs,
      this.mission.paths.message(id),
      Buffer.from(formatMessage(message))
    );
    const { delivered, incomplete } = await this.publishMarkers(message);
    return { message, delivered, incomplete };
  }

  private async publishMarkers(message: MessageRecord) {
    const delivered: RoleId[] = [];
    const incomplete: RoleId[] = [];
    await Promise.all(
      message.recipients.map(async (recipient) => {
        try {
          await this.publishMarker(message, recipient);
          delivered.push(recipient);
        } catch {
          incomplete.push(recipient);
        }
      })
    );
    return { delivered: delivered.sort(), incomplete: incomplete.sort() };
  }
  private async publishMarker(
    message: MessageRecord,
    recipient: RoleId
  ): Promise<boolean> {
    await ensureProtocolDirectory(
      this.fs,
      this.mission.paths.root,
      this.mission.paths.inbox(recipient)
    );
    const marker: DeliveryMarker = {
      formatVersion: 1,
      message: message.id,
      recipient,
      created: message.created,
    };
    return (
      (await publishImmutable(
        this.fs,
        this.mission.paths.marker(recipient, message.id),
        Buffer.from(formatJson(marker))
      )) === "created"
    );
  }
  private async readCursor(
    identity: TrustedIdentity
  ): Promise<CursorRecord | undefined> {
    const path = this.mission.paths.cursor(identity.role, identity.session);
    try {
      return parseJson(
        (await this.fs.readFile(path)).toString("utf8"),
        path,
        validateCursor
      );
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }
  private async writeCursor(identity: TrustedIdentity, returned: MessageId[]) {
    const path = this.mission.paths.cursor(identity.role, identity.session);
    await ensureProtocolDirectory(
      this.fs,
      this.mission.paths.root,
      dirname(this.mission.paths.cursor(identity.role, identity.session))
    );
    await replaceMutable(
      this.fs,
      path,
      Buffer.from(
        formatJson({
          formatVersion: 1,
          role: identity.role,
          session: identity.session,
          returned,
          updated: nowIso(this.clock),
        } satisfies CursorRecord)
      )
    );
  }
}

function validateCursor(value: unknown): CursorRecord {
  const o = exactObject(
    value,
    ["formatVersion", "role", "session", "returned", "updated"],
    ["formatVersion", "role", "session", "returned", "updated"],
    "cursor"
  );
  if (o.formatVersion !== 1 || !Array.isArray(o.returned))
    throw new ValidationError("invalid cursor");
  return {
    formatVersion: 1,
    role: roleId(o.role),
    session: sessionId(o.session),
    returned: o.returned.map(messageId),
    updated: utcTimestamp(o.updated),
  };
}
function validateMarker(value: unknown): DeliveryMarker {
  const o = exactObject(
    value,
    ["formatVersion", "message", "recipient", "created"],
    ["formatVersion", "message", "recipient", "created"],
    "delivery marker"
  );
  if (o.formatVersion !== 1)
    throw new ValidationError("invalid delivery marker formatVersion");
  return {
    formatVersion: 1,
    message: messageId(o.message),
    recipient: roleId(o.recipient),
    created: utcTimestamp(o.created),
  };
}
function limited(value: string, label: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > max ||
    value.includes("\0")
  )
    throw new ValidationError(`${label} is invalid or too large`);
  return value;
}
