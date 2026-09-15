import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type ToolServices, textResult } from "./services";
export const readSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    replay: Type.Optional(Type.Boolean()),
    since: Type.Optional(Type.String()),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1024 })),
  },
  { additionalProperties: false }
);
export type ReadToolInput = Static<typeof readSchema>;
export function createReadTool(
  services: ToolServices
): ToolDefinition<typeof readSchema> {
  return {
    name: "agent_mail_read",
    label: "Read Agent Mail",
    description:
      "Read bounded, non-destructive mail for this trusted role and session. Use replay or since to recover durable records.",
    promptSnippet: "Read durable mission mail for the bound role",
    promptGuidelines: [
      "Use agent_mail_read at task boundaries and when a mailbox notification arrives.",
    ],
    parameters: readSchema,
    async execute(_id, input) {
      const result = await services.mailbox.read(services.identity, input);
      if (!result.messages.length)
        return textResult("No matching new mail.", result);
      const text =
        result.messages
          .map(
            (m) =>
              `[${m.id}] ${m.priority} ${m.kind} from ${m.from} at ${m.created}\n${m.body.trimEnd()}`
          )
          .join("\n\n---\n\n") +
        (result.truncated
          ? `\n\n[${result.remaining} more message(s) remain unread]`
          : "");
      return textResult(text, result);
    },
  };
}
