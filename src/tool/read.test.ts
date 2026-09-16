import { describe, expect, test } from "bun:test";
import type { MessageRecord } from "../protocol";
import { createReadTool, formatMessageForModel } from "./read";
import type { ToolServices } from "./services";

const minimal: MessageRecord = {
  formatVersion: 1,
  id: "01J8Z3K9QATG5V2N7X4R6M1B0C" as never,
  from: "reviewer" as never,
  from_session: "private-session" as never,
  to: "implementer" as never,
  recipients: ["implementer" as never],
  kind: "blocker",
  priority: "P1",
  interrupt: "safe",
  requires_ack: false,
  created: "2026-09-13T17:32:00.000Z",
  body: "Found a failing case.\n",
};

describe("agent_mail_read model formatting", () => {
  test("formats minimal actionable metadata and omits internals", () => {
    const text = formatMessageForModel(minimal);
    expect(text).toBe(
      "[01J8Z3K9QATG5V2N7X4R6M1B0C] P1 blocker from reviewer\n" +
        "created: 2026-09-13T17:32:00.000Z\n" +
        "delivery: interrupt=safe\n\n" +
        "Found a failing case."
    );
    expect(text).not.toContain("formatVersion");
    expect(text).not.toContain("recipients");
    expect(text).not.toContain("private-session");
    expect(text).not.toContain("ack=required");
  });

  test("formats every optional actionable field and required ack", () => {
    const text = formatMessageForModel({
      ...minimal,
      requires_ack: true,
      repo: "pi-presets" as never,
      thread: "preset-handoff",
      in_reply_to: "01J8Z3K9QATG5V2N7X4R6M1B0D" as never,
      deadline: "2026-09-13T18:00:00.000Z",
      paths: ["src/runtime.ts", "src/tool/read.ts"],
      body: "Patch it.\nThen ask reviewer.\n",
    });
    expect(text).toContain("delivery: interrupt=safe, ack=required");
    expect(text).toContain(
      "context: repo=pi-presets, thread=preset-handoff, in_reply_to=01J8Z3K9QATG5V2N7X4R6M1B0D"
    );
    expect(text).toContain("deadline: 2026-09-13T18:00:00.000Z");
    expect(text).toContain("paths:\n- src/runtime.ts\n- src/tool/read.ts");
    expect(text.endsWith("Patch it.\nThen ask reviewer.")).toBeTrue();
  });

  test("normalizes metadata to one line without changing body content", () => {
    const text = formatMessageForModel({
      ...minimal,
      thread: "handoff\nforged: value\tcontinued",
      paths: ["src/one.ts\npriority: P0"],
      body: "body header:\ncreated: untouched\n",
    });
    expect(text).toContain(
      "context: thread=handoff forged: value continued\npaths:\n- src/one.ts priority: P0"
    );
    expect(text).toContain("body header:\ncreated: untouched");
  });

  test("preserves separators, truncation notice, and result details", async () => {
    const readResult = {
      messages: [
        minimal,
        { ...minimal, id: "01J8Z3K9QATG5V2N7X4R6M1B0D" as never },
      ],
      truncated: true,
      remaining: 3,
    };
    const services = {
      mailbox: { read: async () => readResult },
      identity: {},
    } as unknown as ToolServices;
    const tool = createReadTool(services);
    const output = await tool.execute(
      "call-1",
      {},
      undefined,
      undefined,
      {} as never
    );
    const content = output.content[0];
    if (content?.type !== "text") throw new Error("missing text");
    expect(content.text.match(/\n\n---\n\n/g)).toHaveLength(1);
    expect(content.text).toEndWith("[3 more message(s) remain unread]");
    expect(output.details).toBe(readResult);
  });
});
