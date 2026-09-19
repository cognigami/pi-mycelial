import { StringEnum } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { INTERRUPTS, MESSAGE_KINDS, PRIORITIES } from "../protocol";
import {
  notificationText,
  notifyDelivered,
  publicNotificationOutcomes,
} from "./notify";
import { type ToolServices, textResult } from "./services";
import type { WakeDispatcher } from "./wake";
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
  services: ToolServices,
  dispatcher: WakeDispatcher
): ToolDefinition<typeof sendSchema> {
  return {
    name: "agent_mail_send",
    label: "Send Agent Mail",
    description:
      "Durably send a message to a mission role or all roles, then best-effort wake delivered recipients. Identity is supplied by the trusted runtime.",
    promptSnippet:
      "Send durable mission mail and automatically notify delivered recipients",
    promptGuidelines: [
      "Use agent_mail_send for durable agent coordination; never put identity fields in its input. Automatic wake-up follows durable delivery, so call agent_wake only to retry a reported notification failure.",
    ],
    parameters: sendSchema,
    async execute(_id, input, signal) {
      const result = await services.mailbox.send(services.identity, input);
      const notifications = await notifyDelivered(
        dispatcher,
        services.identity.role,
        result.delivered,
        signal
      );
      return textResult(
        `Sent ${result.message.id} to ${result.message.recipients.join(", ")}${result.incomplete.length ? `; incomplete markers: ${result.incomplete.join(", ")}` : ""}.${notificationText(notifications)}`,
        {
          ...result,
          notifications: publicNotificationOutcomes(notifications),
        }
      );
    },
  };
}
