import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type ToolServices, textResult } from "./services";
export const rosterSchema = Type.Object(
  { refresh: Type.Optional(Type.Boolean()) },
  { additionalProperties: false }
);
export type RosterToolInput = Static<typeof rosterSchema>;
export function createRosterTool(
  services: ToolServices
): ToolDefinition<typeof rosterSchema> {
  return {
    name: "agent_roster",
    label: "Agent Roster",
    description:
      "List every non-expired mission session, optionally refreshing only this session's presence.",
    promptSnippet: "List live sessions in the mission roster",
    promptGuidelines: [
      "Use agent_roster for discovery and status, not as mailbox addressing or task ownership.",
    ],
    parameters: rosterSchema,
    async execute(_id, input) {
      const records = await services.projections.roster(
        input.refresh ? services.identity : undefined,
        input.refresh ? services.config.presenceTtlMs : undefined
      );
      const text = records.length
        ? records
            .map((r) => `${r.role}/${r.session} online until ${r.expires}`)
            .join("\n")
        : "No live mission sessions.";
      return textResult(text, { records });
    },
  };
}
