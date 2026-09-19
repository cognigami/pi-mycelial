import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { RoleId } from "../identifiers";
import { roleId, ValidationError } from "../identifiers";
import { type ToolServices, textResult } from "./services";

export const WAKE_PROMPT = "Mycelial mail is waiting. Read agent_mail_read.";
const WAKE_TIMEOUT_MS = 10_000;

export const wakeSchema = Type.Object(
  {
    to: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false }
);
export type WakeToolInput = Static<typeof wakeSchema>;

export interface WakeCommandResult {
  code: number;
  killed: boolean;
}

export type WakeCommandRunner = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeout: number }
) => Promise<WakeCommandResult>;

export type WakeOutcome =
  | { status: "sent"; recipient: RoleId }
  | {
      status: "failed";
      recipient: RoleId;
      code: number;
      killed: boolean;
    }
  | { status: "unavailable"; recipient: RoleId; reason: string }
  | { status: "cancelled"; recipient: RoleId; reason: string };

export type PublicWakeOutcome =
  | Extract<WakeOutcome, { status: "sent" | "failed" }>
  | { status: "unavailable" | "cancelled"; recipient: RoleId };

export interface WakeDispatcher {
  wake(recipient: RoleId, signal?: AbortSignal): Promise<WakeOutcome>;
}

export function createWakeDispatcher(run: WakeCommandRunner): WakeDispatcher {
  const inFlight = new Map<RoleId, Promise<WakeOutcome>>();
  return {
    async wake(recipient, signal) {
      const pending = inFlight.get(recipient);
      if (pending) return pending;

      const current = dispatchWake(run, recipient, signal);
      inFlight.set(recipient, current);
      try {
        return await current;
      } finally {
        if (inFlight.get(recipient) === current) inFlight.delete(recipient);
      }
    },
  };
}

async function dispatchWake(
  run: WakeCommandRunner,
  recipient: RoleId,
  signal?: AbortSignal
): Promise<WakeOutcome> {
  if (signal?.aborted)
    return {
      status: "cancelled",
      recipient,
      reason: oneLineError(signal.reason ?? "cancelled"),
    };
  try {
    const result = await run(
      "herdr",
      ["agent", "prompt", recipient, WAKE_PROMPT],
      { signal, timeout: WAKE_TIMEOUT_MS }
    );
    if (result.code === 0) return { status: "sent", recipient };
    return {
      status: "failed",
      recipient,
      code: result.code,
      killed: result.killed,
    };
  } catch (error) {
    return {
      status: signal?.aborted ? "cancelled" : "unavailable",
      recipient,
      reason: oneLineError(error),
    };
  }
}

export function createWakeTool(
  services: ToolServices,
  dispatcher: WakeDispatcher
): ToolDefinition<typeof wakeSchema> {
  return {
    name: "agent_wake",
    label: "Wake Mission Agent",
    description:
      "Retry a best-effort live wake-up for one configured mission role after durable Mycelial mail succeeds. Sends a fixed notification through the role-named Herdr agent; durable mail remains authoritative.",
    promptSnippet:
      "Retry waking a configured mission role after automatic notification fails",
    promptGuidelines: [
      "Use agent_wake only to retry a failed automatic notification reported by agent_mail_send or agent_mail_reply; never use it to carry task content or replace durable mail.",
    ],
    parameters: wakeSchema,
    async execute(_id, input, signal) {
      const recipient = roleId(input.to);
      if (!services.mailbox.mission.roles.includes(recipient))
        throw new ValidationError(`Unknown recipient role: ${input.to}`);
      if (recipient === services.identity.role)
        throw new ValidationError(
          "agent_wake cannot target the bound role itself"
        );

      const outcome = await dispatcher.wake(recipient, signal);
      if (outcome.status === "cancelled" && signal?.aborted)
        throw signal.reason ?? new Error("Wake-up cancelled");
      return textResult(wakeOutcomeText(outcome), publicWakeOutcome(outcome));
    },
  };
}

export function wakeOutcomeText(outcome: WakeOutcome): string {
  if (outcome.status === "sent")
    return `Wake-up sent to ${outcome.recipient}. Durable Mycelial mail remains authoritative.`;
  if (outcome.status === "failed")
    return `Herdr could not wake ${outcome.recipient} (exit ${outcome.code}${outcome.killed ? ", terminated" : ""}). Durable Mycelial mail remains authoritative.`;
  if (outcome.status === "cancelled")
    return `Herdr wake-up for ${outcome.recipient} was cancelled (${outcome.reason}). Durable Mycelial mail remains authoritative.`;
  return `Herdr could not wake ${outcome.recipient} (${outcome.reason}). Durable Mycelial mail remains authoritative.`;
}

export function publicWakeOutcome(outcome: WakeOutcome): PublicWakeOutcome {
  if (outcome.status === "unavailable" || outcome.status === "cancelled")
    return { status: outcome.status, recipient: outcome.recipient };
  return outcome;
}

function oneLineError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 240) || "unavailable";
}
