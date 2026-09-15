import { StringEnum } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { INTERRUPTS, MESSAGE_KINDS, PRIORITIES } from "../protocol";
import { type ToolServices, textResult } from "./services";
export const sendSchema = Type.Object(
  {
    to: Type.String({ minLength: 1, maxLength: 128 }),
    body: Type.String({ minLength: 1 }),
    kind: Type.Optional(StringEnum(MESSAGE_KINDS)),
    priority: Type.Optional(StringEnum(PRIORITIES)),
    interrupt: Type.Optional(StringEnum(INTERRUPTS)),
    requires_ack: Type.Optional(Type.Boolean()),
    repo: Type.Optional(Type.String()),
    thread: Type.Optional(Type.String()),
    deadline: Type.Optional(Type.String()),
    paths: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
  },
  { additionalProperties: false }
);
export type SendToolInput = Static<typeof sendSchema>;
export function createSendTool(
  services: ToolServices
): ToolDefinition<typeof sendSchema> {
  return {
    name: "agent_mail_send",
    label: "Send Agent Mail",
    description:
      "Durably send a message to a mission role or all roles. Identity is supplied by the trusted runtime.",
    promptSnippet: "Send durable mission mail to a role or all roles",
    promptGuidelines: [
      "Use agent_mail_send for durable agent coordination; never put identity fields in its input.",
    ],
    parameters: sendSchema,
    async execute(_id, input) {
      const result = await services.mailbox.send(services.identity, input);
      return textResult(
        `Sent ${result.message.id} to ${result.message.recipients.join(", ")}${result.incomplete.length ? `; incomplete markers: ${result.incomplete.join(", ")}` : ""}.`,
        result
      );
    },
  };
}
