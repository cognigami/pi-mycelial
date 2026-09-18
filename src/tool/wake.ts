import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
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

export function createWakeTool(
  services: ToolServices,
  run: WakeCommandRunner
): ToolDefinition<typeof wakeSchema> {
  return {
    name: "agent_wake",
    label: "Wake Mission Agent",
    description:
      "Best-effort live wake-up for one configured mission role after durable Mycelial mail succeeds. Sends a fixed notification through the role-named Herdr agent; durable mail remains authoritative.",
    promptSnippet:
      "Wake a configured mission role after durable Mycelial mail succeeds",
    promptGuidelines: [
      "Call agent_wake only after agent_mail_send or agent_mail_reply succeeds; never use it to carry task content or replace durable mail.",
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

      try {
        const result = await run(
          "herdr",
          ["agent", "prompt", recipient, WAKE_PROMPT],
          { signal, timeout: WAKE_TIMEOUT_MS }
        );
        if (result.code === 0)
          return textResult(
            `Wake-up sent to ${recipient}. Durable Mycelial mail remains authoritative.`,
            { status: "sent", recipient }
          );
        return textResult(
          `Herdr could not wake ${recipient} (exit ${result.code}${result.killed ? ", terminated" : ""}). Durable Mycelial mail remains authoritative.`,
          {
            status: "failed",
            recipient,
            code: result.code,
            killed: result.killed,
          }
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        return textResult(
          `Herdr could not wake ${recipient} (${oneLineError(error)}). Durable Mycelial mail remains authoritative.`,
          { status: "unavailable", recipient }
        );
      }
    },
  };
}

function oneLineError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 240) || "unavailable";
}
