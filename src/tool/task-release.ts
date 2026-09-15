import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type ToolServices, textResult } from "./services";
export const taskReleaseSchema = Type.Object(
  {
    task: Type.String({ minLength: 1, maxLength: 128 }),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
export type TaskReleaseToolInput = Static<typeof taskReleaseSchema>;
export function createTaskReleaseTool(
  services: ToolServices
): ToolDefinition<typeof taskReleaseSchema> {
  return {
    name: "agent_task_release",
    label: "Release Agent Task",
    description:
      "Release a task claim only when it belongs to the bound role and session.",
    promptSnippet: "Release an owned mission task claim",
    promptGuidelines: [
      "Use agent_task_release when owned work completes or is handed off.",
    ],
    parameters: taskReleaseSchema,
    async execute(_id, input) {
      const result = await services.projections.release(
        services.identity,
        input.task,
        input.note
      );
      return textResult(`Task ${input.task}: ${result.outcome}.`, result);
    },
  };
}
