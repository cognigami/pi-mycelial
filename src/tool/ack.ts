import { StringEnum } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { RECEIPT_EVENTS } from "../protocol";
import { type ToolServices, textResult } from "./services";
export const ackSchema = Type.Object(
  {
    message: Type.String(),
    event: StringEnum(RECEIPT_EVENTS),
    note: Type.Optional(Type.String()),
    delegated_to: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
export type AckToolInput = Static<typeof ackSchema>;
export function createAckTool(
  services: ToolServices
): ToolDefinition<typeof ackSchema> {
  return {
    name: "agent_mail_ack",
    label: "Acknowledge Agent Mail",
    description:
      "Append an immutable receipt event for a message delivered to the bound role.",
    promptSnippet: "Acknowledge mission mail with an append-only receipt",
    promptGuidelines: [
      "Use agent_mail_ack to record seen, accepted, declined, delegated, or done states when appropriate.",
    ],
    parameters: ackSchema,
    async execute(_id, input) {
      const receipt = await services.mailbox.acknowledge(
        services.identity,
        input
      );
      return textResult(
        `Recorded ${receipt.event} for ${receipt.message}.`,
        receipt
      );
    },
  };
}
