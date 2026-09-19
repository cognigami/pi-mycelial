import { StringEnum } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { INTERRUPTS, PRIORITIES } from "../protocol";
import {
  notificationText,
  notifyDelivered,
  publicNotificationOutcomes,
} from "./notify";
import { type ToolServices, textResult } from "./services";
import type { WakeDispatcher } from "./wake";
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
  services: ToolServices,
  dispatcher: WakeDispatcher
): ToolDefinition<typeof replySchema> {
  return {
    name: "agent_mail_reply",
    label: "Reply to Agent Mail",
    description:
      "Reply to a message's trusted sender, preserve thread linkage, then best-effort wake delivered recipients.",
    promptSnippet:
      "Reply durably to the trusted sender and automatically notify them",
    promptGuidelines: [
      "Use agent_mail_reply instead of agent_mail_send when responding to an existing message. Automatic wake-up follows durable delivery, so call agent_wake only to retry a reported notification failure.",
    ],
    parameters: replySchema,
    async execute(_id, input, signal) {
      const result = await services.mailbox.reply(services.identity, input);
      const notifications = await notifyDelivered(
        dispatcher,
        services.identity.role,
        result.delivered,
        signal
      );
      return textResult(
        `Replied with ${result.message.id} to ${result.message.recipients.join(", ")}.${notificationText(notifications)}`,
        {
          ...result,
          notifications: publicNotificationOutcomes(notifications),
        }
      );
    },
  };
}
