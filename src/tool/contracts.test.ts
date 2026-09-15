import { describe, expect, test } from "bun:test";
import { ackSchema, createAckTool } from "./ack";
import { createReadTool, readSchema } from "./read";
import { createReplyTool, replySchema } from "./reply";
import { createRosterTool, rosterSchema } from "./roster";
import { createSendTool, sendSchema } from "./send";
import type { ToolServices } from "./services";
import { createTaskClaimTool, taskClaimSchema } from "./task-claim";
import { createTaskReleaseTool, taskReleaseSchema } from "./task-release";

const schemas = [
  sendSchema,
  readSchema,
  ackSchema,
  replySchema,
  taskClaimSchema,
  taskReleaseSchema,
  rosterSchema,
];
describe("model-facing contracts", () => {
  test("have stable names and composition order", () => {
    const services = {} as ToolServices;
    expect(
      [
        createSendTool(services),
        createReadTool(services),
        createAckTool(services),
        createReplyTool(services),
        createTaskClaimTool(services),
        createTaskReleaseTool(services),
        createRosterTool(services),
      ].map((tool) => tool.name)
    ).toEqual([
      "agent_mail_send",
      "agent_mail_read",
      "agent_mail_ack",
      "agent_mail_reply",
      "agent_task_claim",
      "agent_task_release",
      "agent_roster",
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
