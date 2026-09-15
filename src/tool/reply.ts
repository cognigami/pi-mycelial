import { StringEnum } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { INTERRUPTS, PRIORITIES } from "../protocol";
import { type ToolServices, textResult } from "./services";
export const replySchema = Type.Object(
  {
    message: Type.String(),
    body: Type.String({ minLength: 1 }),
    priority: Type.Optional(StringEnum(PRIORITIES)),
    interrupt: Type.Optional(StringEnum(INTERRUPTS)),
  },
  { additionalProperties: false }
);
export type ReplyToolInput = Static<typeof replySchema>;
export function createReplyTool(
  services: ToolServices
): ToolDefinition<typeof replySchema> {
  return {
    name: "agent_mail_reply",
    label: "Reply to Agent Mail",
    description:
      "Reply to a message's trusted sender, preserving thread and reply linkage.",
    promptSnippet: "Reply to the trusted sender of mission mail",
    promptGuidelines: [
      "Use agent_mail_reply instead of agent_mail_send when responding to an existing message.",
    ],
    parameters: replySchema,
    async execute(_id, input) {
      const result = await services.mailbox.reply(services.identity, input);
      return textResult(
        `Replied with ${result.message.id} to ${result.message.recipients.join(", ")}.`,
        result
      );
    },
  };
}
