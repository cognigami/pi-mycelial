import { describe, expect, test } from "bun:test";
import { ackSchema, createAckTool } from "./ack";
import { createMissionReadTool, missionReadSchema } from "./mission-read";
import { createReadTool, readSchema } from "./read";
import { createReplyTool, replySchema } from "./reply";
import { createRosterTool, rosterSchema } from "./roster";
import { createSendTool, sendSchema } from "./send";
import type { ToolServices } from "./services";
import { createTaskClaimTool, taskClaimSchema } from "./task-claim";
import { createTaskReleaseTool, taskReleaseSchema } from "./task-release";
import { createWakeDispatcher, createWakeTool, wakeSchema } from "./wake";

const schemas = [
  missionReadSchema,
  sendSchema,
  readSchema,
  ackSchema,
  replySchema,
  taskClaimSchema,
  taskReleaseSchema,
  rosterSchema,
  wakeSchema,
];
describe("model-facing contracts", () => {
  test("have stable names and composition order", () => {
    const services = {} as ToolServices;
    const dispatcher = createWakeDispatcher(async () => ({
      code: 0,
      killed: false,
    }));
    expect(
      [
        createMissionReadTool(services),
        createSendTool(services, dispatcher),
        createReadTool(services),
        createAckTool(services),
        createReplyTool(services, dispatcher),
        createTaskClaimTool(services),
        createTaskReleaseTool(services),
        createRosterTool(services),
        createWakeTool(services, dispatcher),
      ].map((tool) => tool.name)
    ).toEqual([
      "agent_mission_read",
      "agent_mail_send",
      "agent_mail_read",
      "agent_mail_ack",
      "agent_mail_reply",
      "agent_task_claim",
      "agent_task_release",
      "agent_roster",
      "agent_wake",
    ]);
  });
  test("are closed and contain no trusted identity fields", () => {
    for (const schema of schemas) {
      expect(
        (schema as { additionalProperties?: boolean }).additionalProperties
      ).toBeFalse();
      for (const key of [
        "mission",
        "role",
        "sender",
        "from",
        "from_session",
        "session",
      ])
        expect(schema.properties).not.toHaveProperty(key);
    }
  });
});
