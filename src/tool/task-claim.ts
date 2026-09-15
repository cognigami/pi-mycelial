import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { messageId, ValidationError } from "../identifiers";
import { type ToolServices, textResult } from "./services";
export const taskClaimSchema = Type.Object(
  {
    task: Type.String({ minLength: 1, maxLength: 128 }),
    message: Type.Optional(Type.String()),
    lease_ms: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false }
);
export type TaskClaimToolInput = Static<typeof taskClaimSchema>;
export function createTaskClaimTool(
  services: ToolServices
): ToolDefinition<typeof taskClaimSchema> {
  return {
    name: "agent_task_claim",
    label: "Claim Agent Task",
    description:
      "Atomically claim, renew, or take over an expired mission task lease. Contention is returned as data.",
    promptSnippet: "Atomically claim or renew a mission task lease",
    promptGuidelines: [
      "Use agent_task_claim before beginning work that agents could race to perform.",
    ],
    parameters: taskClaimSchema,
    async execute(_id, input) {
      const lease = input.lease_ms ?? services.config.defaultLeaseMs;
      if (
        lease < services.config.minLeaseMs ||
        lease > services.config.maxLeaseMs
      )
        throw new ValidationError(
          `lease_ms must be between ${services.config.minLeaseMs} and ${services.config.maxLeaseMs}`
        );
      if (input.message) {
        const source = await services.mailbox.loadMessage(
          messageId(input.message)
        );
        if (!source.recipients.includes(services.identity.role))
          throw new ValidationError(
            "Bound role is not a recipient of the source message"
          );
      }
      const result = await services.projections.claim(
        services.identity,
        input.task,
        lease,
        input.message
      );
      return textResult(
        result.outcome === "contended"
          ? `Task ${input.task} is contended.`
          : `Task ${input.task}: ${result.outcome}.`,
        result
      );
    },
  };
}
