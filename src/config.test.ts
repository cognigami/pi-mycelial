import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./config";

test("defaults missions under the Mycelial home directory", () => {
  expect(DEFAULT_CONFIG.missionRoot).toBe(
    join(homedir(), "mycelial", "missions")
  );
});
