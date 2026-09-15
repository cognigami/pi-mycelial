import { describe, expect, test } from "bun:test";
import { formatMessage, parseMessage } from "./message-codec";
import type { MessageRecord } from "./protocol";

const message: MessageRecord = {
  formatVersion: 1,
  id: "01J8Z3K9QATG5V2N7X4R6M1B0C" as never,
  from: "reviewer" as never,
  from_session: "session-1" as never,
  to: "implementer" as never,
  recipients: ["implementer" as never],
  kind: "blocker",
  priority: "P1",
  interrupt: "safe",
  requires_ack: true,
  created: "2026-09-13T17:32:00.000Z",
  body: "before\n---\nafter\n",
};
describe("message codec", () => {
  test("round trips body delimiters deterministically", () => {
    const text = formatMessage(message);
    expect(parseMessage(text)).toEqual(message);
    expect(formatMessage(parseMessage(text))).toBe(text);
  });
  test("reports path without including corrupt content", () => {
    expect(() => parseMessage("secret", "/mail/a.md")).toThrow("/mail/a.md");
    expect(() => parseMessage("secret", "/mail/a.md")).not.toThrow("secret");
  });
});
