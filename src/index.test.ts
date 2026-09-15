import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mycelialExtension from "./index";

test("package composition root loads inert and registers binding lifecycle", () => {
  const flags: string[] = [];
  const events: string[] = [];
  let tools = 0;
  const pi = {
    registerFlag(name: string) {
      flags.push(name);
    },
    on(name: string) {
      events.push(name);
    },
    registerTool() {
      tools++;
    },
  } as unknown as ExtensionAPI;
  mycelialExtension(pi);
  expect(flags).toEqual([
    "mycelial-mission",
    "mycelial-role",
    "mycelial-session",
  ]);
  expect(events).toEqual(["session_start", "session_shutdown"]);
  expect(tools).toBe(0);
});
