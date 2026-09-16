import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { readMissionDocument } from "../mission";
import { type ToolServices, textResult } from "./services";

export const missionReadSchema = Type.Object(
  {},
  { additionalProperties: false }
);
export type MissionReadToolInput = Static<typeof missionReadSchema>;

export function createMissionReadTool(
  services: ToolServices
): ToolDefinition<typeof missionReadSchema> {
  return {
    name: "agent_mission_read",
    label: "Read Mission",
    description:
      "Read the bounded mission.md selected by this session's trusted binding. Accepts no path or identity arguments.",
    promptSnippet: "Read the trusted mission document for this bound session",
    promptGuidelines: [
      "Use agent_mission_read when joining a Mycelial mission before reading mail or claiming work.",
    ],
    parameters: missionReadSchema,
    async execute() {
      const result = await readMissionDocument(
        services.mailbox.fs,
        services.mailbox.mission,
        services.config.readMaxBytes
      );
      const body = result.text.trimEnd() || "(mission.md is empty)";
      const text = result.truncated
        ? `${body}\n\n[mission.md truncated: showing ${services.config.readMaxBytes} of ${result.totalBytes} bytes]`
        : body;
      return textResult(text, result);
    },
  };
}
