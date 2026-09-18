import { expect, test } from "bun:test";
import type { ToolServices } from "./services";
import { createWakeTool, WAKE_PROMPT, type WakeCommandRunner } from "./wake";

function services(): ToolServices {
  return {
    identity: { role: "coordinator" },
    mailbox: {
      mission: { roles: ["builder", "coordinator"] },
    },
  } as unknown as ToolServices;
}

test("sends a fixed Herdr wake-up to a configured mission role", async () => {
  const calls: Array<{ command: string; args: string[]; timeout: number }> = [];
  const run: WakeCommandRunner = async (command, args, options) => {
    calls.push({ command, args, timeout: options.timeout });
    return { code: 0, killed: false };
  };
  const tool = createWakeTool(services(), run);

  const result = await tool.execute(
    "tool-call",
    { to: "builder" },
    new AbortController().signal,
    undefined,
    {} as never
  );

  expect(calls).toEqual([
    {
      command: "herdr",
      args: ["agent", "prompt", "builder", WAKE_PROMPT],
      timeout: 10_000,
    },
  ]);
  expect(result.details).toEqual({ status: "sent", recipient: "builder" });
});

test("rejects unknown and self recipients before invoking Herdr", async () => {
  let calls = 0;
  const run: WakeCommandRunner = async () => {
    calls++;
    return { code: 0, killed: false };
  };
  const tool = createWakeTool(services(), run);

  await expect(
    tool.execute(
      "unknown",
      { to: "reviewer" },
      undefined,
      undefined,
      {} as never
    )
  ).rejects.toThrow("Unknown recipient role");
  await expect(
    tool.execute(
      "self",
      { to: "coordinator" },
      undefined,
      undefined,
      {} as never
    )
  ).rejects.toThrow("cannot target the bound role itself");
  expect(calls).toBe(0);
});

test("keeps durable mail authoritative when Herdr is unavailable", async () => {
  const tool = createWakeTool(services(), async () => {
    throw new Error("herdr is not installed");
  });

  const result = await tool.execute(
    "tool-call",
    { to: "builder" },
    undefined,
    undefined,
    {} as never
  );

  expect(result.content[0]).toEqual({
    type: "text",
    text: "Herdr could not wake builder (herdr is not installed). Durable Mycelial mail remains authoritative.",
  });
  expect(result.details).toEqual({
    status: "unavailable",
    recipient: "builder",
  });
});
