import type {
  EventId,
  MessageId,
  MissionId,
  RepoAlias,
  RoleId,
  SessionId,
  TaskId,
} from "./identifiers";
import { ValidationError } from "./identifiers";

export const FORMAT_VERSION = 1 as const;
export const MESSAGE_KINDS = [
  "request",
  "update",
  "blocker",
  "decision",
  "handoff",
  "fyi",
] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const INTERRUPTS = [
  "now",
  "safe",
  "task-boundary",
  "next-checkpoint",
] as const;
export const RECEIPT_EVENTS = [
  "seen",
  "accepted",
  "declined",
  "delegated",
  "done",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Interrupt = (typeof INTERRUPTS)[number];
export type ReceiptEventName = (typeof RECEIPT_EVENTS)[number];

export interface TrustedIdentity {
  mission: MissionId;
  role: RoleId;
  session: SessionId;
}
export interface MessageRecord {
  formatVersion: 1;
  id: MessageId;
  from: RoleId;
  from_session: SessionId;
  to: RoleId | "all";
  recipients: RoleId[];
  kind: MessageKind;
  priority: Priority;
  interrupt: Interrupt;
  requires_ack: boolean;
  created: string;
  body: string;
  repo?: RepoAlias;
  thread?: string;
  in_reply_to?: MessageId;
  deadline?: string;
  paths?: string[];
}
export interface DeliveryMarker {
  formatVersion: 1;
  message: MessageId;
  recipient: RoleId;
  created: string;
}
export interface ReceiptRecord {
  formatVersion: 1;
  id: EventId;
  message: MessageId;
  agent: RoleId;
  session: SessionId;
  event: ReceiptEventName;
  created: string;
  note?: string;
  delegated_to?: RoleId;
}
export interface CursorRecord {
  formatVersion: 1;
  role: RoleId;
  session: SessionId;
  returned: MessageId[];
  updated: string;
}
export interface ClaimRecord {
  formatVersion: 1;
  task: TaskId;
  message?: MessageId;
  agent: RoleId;
  session: SessionId;
  status: "claimed" | "released";
  version: number;
  expires: string;
  created: string;
  updated: string;
  observed_prior_version?: number;
  note?: string;
}
export interface LockOwner {
  formatVersion: 1;
  token: string;
  pid: number;
  session: SessionId;
  acquired: string;
}
export interface RosterRecord {
  formatVersion: 1;
  role: RoleId;
  session: SessionId;
  pid: number;
  heartbeat: string;
  expires: string;
  status: "online" | "offline";
}

export interface SendInput {
  to: string;
  body: string;
  kind?: MessageKind;
  priority?: Priority;
  interrupt?: Interrupt;
  requires_ack?: boolean;
  repo?: string;
  thread?: string;
  deadline?: string;
  paths?: string[];
}
export interface ReadInput {
  limit?: number;
  replay?: boolean;
  since?: string;
  maxBytes?: number;
}
export interface AckInput {
  message: string;
  event: ReceiptEventName;
  note?: string;
  delegated_to?: string;
}
export interface ReplyInput {
  message: string;
  body: string;
  priority?: Priority;
  interrupt?: Interrupt;
}

export function assertClosed<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    throw new ValidationError(`${label} must be one of: ${values.join(", ")}`);
  return value as T;
}
export function exactObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object))
    if (!allowed.includes(key))
      throw new ValidationError(`${label} contains unknown field ${key}`);
  for (const key of required)
    if (!(key in object))
      throw new ValidationError(`${label} is missing ${key}`);
  return object;
}
