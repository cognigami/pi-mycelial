import { expect, test } from "bun:test";
import type { SendResult } from "../mailbox-store";
import { createReplyTool } from "./reply";
import { createSendTool } from "./send";
import type { ToolServices } from "./services";
import { createWakeDispatcher, type WakeDispatcher } from "./wake";

const baseResult = {
  message: {
    id: "01M2WSHJA64MHZMM8V73JXFGEF",
    recipients: ["builder"],
  },
  delivered: ["builder"],
  incomplete: [],
} as unknown as SendResult;

function services(mailbox: Record<string, unknown>): ToolServices {
  return {
    identity: { role: "coordinator" },
    mailbox,
  } as unknown as ToolServices;
}

function dispatcher(wake: WakeDispatcher["wake"]): WakeDispatcher {
  return { wake };
}

test("send publishes durable mail before automatically waking recipients", async () => {
  const events: string[] = [];
  const tool = createSendTool(
    services({
      async send() {
        events.push("durable-send");
        return baseResult;
      },
    }),
    dispatcher(async (recipient) => {
      events.push(`wake-${recipient}`);
      return { status: "sent", recipient };
    })
  );

  const result = await tool.execute(
    "send",
    { to: "builder", body: "Do the work." },
    undefined,
    undefined,
    {} as never
  );

  expect(events).toEqual(["durable-send", "wake-builder"]);
  expect(result.content[0]).toEqual({
    type: "text",
    text: "Sent 01M2WSHJA64MHZMM8V73JXFGEF to builder. Wake-up sent to builder. Durable Mycelial mail remains authoritative.",
  });
  expect(
    (result.details as { notifications: unknown[] }).notifications
  ).toEqual([{ status: "sent", recipient: "builder" }]);
});

test("reply automatically wakes the original sender after durable publication", async () => {
  const events: string[] = [];
  const tool = createReplyTool(
    services({
      async reply() {
        events.push("durable-reply");
        return baseResult;
      },
    }),
    dispatcher(async (recipient) => {
      events.push(`wake-${recipient}`);
      return { status: "sent", recipient };
    })
  );

  await tool.execute(
    "reply",
    { message: "01M2WR24FRJH4T5Q74RMDFESQ3", body: "Complete." },
    undefined,
    undefined,
    {} as never
  );

  expect(events).toEqual(["durable-reply", "wake-builder"]);
});

test("durable publication failure prevents automatic wake-up", async () => {
  let wakes = 0;
  const tool = createSendTool(
    services({
      async send() {
        throw new Error("publish failed");
      },
    }),
    dispatcher(async (recipient) => {
      wakes++;
      return { status: "sent", recipient };
    })
  );

  await expect(
    tool.execute(
      "send",
      { to: "builder", body: "Do the work." },
      undefined,
      undefined,
      {} as never
    )
  ).rejects.toThrow("publish failed");
  expect(wakes).toBe(0);
});

test("wake failure does not invalidate durable mail", async () => {
  const tool = createSendTool(
    services({
      async send() {
        return baseResult;
      },
    }),
    dispatcher(async (recipient) => ({
      status: "unavailable",
      recipient,
      reason: "herdr is not installed",
    }))
  );

  const result = await tool.execute(
    "send",
    { to: "builder", body: "Do the work." },
    undefined,
    undefined,
    {} as never
  );

  expect(result.content[0]).toEqual({
    type: "text",
    text: "Sent 01M2WSHJA64MHZMM8V73JXFGEF to builder. Herdr could not wake builder (herdr is not installed). Durable Mycelial mail remains authoritative.",
  });
  expect(
    (result.details as { notifications: unknown[] }).notifications
  ).toEqual([{ status: "unavailable", recipient: "builder" }]);
});

test("fan-out wakes delivered roles, skips self, and preserves cancellation", async () => {
  const controller = new AbortController();
  const result = {
    ...baseResult,
    message: {
      ...baseResult.message,
      recipients: ["builder", "coordinator", "reviewer"],
    },
    delivered: ["builder", "coordinator", "reviewer"],
  } as unknown as SendResult;
  const calls: string[] = [];
  const wakeDispatcher = createWakeDispatcher(async (_command, args) => {
    calls.push(args[2] ?? "missing");
    return { code: 0, killed: false };
  });
  const tool = createSendTool(
    services({
      async send() {
        controller.abort(new Error("operator cancelled"));
        return result;
      },
    }),
    wakeDispatcher
  );

  const response = await tool.execute(
    "send",
    { to: "all", body: "Status update." },
    controller.signal,
    undefined,
    {} as never
  );

  expect(calls).toEqual([]);
  expect(
    (response.details as { notifications: unknown[] }).notifications
  ).toEqual([
    { status: "cancelled", recipient: "builder" },
    { status: "skipped-self", recipient: "coordinator" },
    { status: "cancelled", recipient: "reviewer" },
  ]);
});
