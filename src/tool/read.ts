import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { MessageRecord } from "../protocol";
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

export function formatMessageForModel(message: MessageRecord): string {
  const lines = [
    `[${message.id}] ${message.priority} ${message.kind} from ${message.from}`,
    `created: ${oneLine(message.created)}`,
    `delivery: interrupt=${message.interrupt}${message.requires_ack ? ", ack=required" : ""}`,
  ];
  const context = [
    message.repo === undefined ? undefined : `repo=${oneLine(message.repo)}`,
    message.thread === undefined
      ? undefined
      : `thread=${oneLine(message.thread)}`,
    message.in_reply_to === undefined
      ? undefined
      : `in_reply_to=${oneLine(message.in_reply_to)}`,
  ].filter((value): value is string => value !== undefined);
  if (context.length > 0) lines.push(`context: ${context.join(", ")}`);
  if (message.deadline !== undefined)
    lines.push(`deadline: ${oneLine(message.deadline)}`);
  if (message.paths !== undefined && message.paths.length > 0) {
    lines.push("paths:");
    for (const path of message.paths) lines.push(`- ${oneLine(path)}`);
  }
  return `${lines.join("\n")}\n\n${message.body.trimEnd()}`;
}

function oneLine(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
      ? " "
      : character;
  })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

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
        result.messages.map(formatMessageForModel).join("\n\n---\n\n") +
        (result.truncated
          ? `\n\n[${result.remaining} more message(s) remain unread]`
          : "");
      return textResult(text, result);
    },
  };
}
