import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionFiles, ExtensionLogger } from "pi-extension-kit/files";
import { DEFAULT_CONFIG } from "./config";
import { nodeFileSystem } from "./filesystem";
import { MycelialRuntime } from "./runtime";

test("cold and active mismatched rebind reject before any runtime writes", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mycelial-runtime-"))
  );
  let writes = 0;
  const files = {
    loadConfig: async () => ({
      config: { ...DEFAULT_CONFIG, missionRoot: root },
    }),
  } as unknown as ExtensionFiles;
  const logger = {
    info: async () => {},
    error: async () => {},
  } as unknown as ExtensionLogger;
  const fs = {
    ...nodeFileSystem,
    open: async (...args: Parameters<typeof nodeFileSystem.open>) => {
      writes++;
      return nodeFileSystem.open(...args);
    },
  };
  const runtime = new MycelialRuntime(files, logger, fs);
  try {
    await expect(
      runtime.start({
        mission: "m",
        role: "builder",
        session: "old",
        hostSession: "new",
      })
    ).rejects.toThrow("does not match");
    expect(writes).toBe(0);
    await nodeFileSystem.mkdir(join(root, "m"));
    await writeFile(join(root, "m", "mission.md"), "# M");
    await writeFile(join(root, "m", "agents.json"), '["builder"]');
    await runtime.start({ mission: "m", role: "builder", hostSession: "old" });
    writes = 0;
    await expect(
      runtime.start({
        mission: "m",
        role: "builder",
        session: "old",
        hostSession: "new",
      })
    ).rejects.toThrow("does not match");
    expect(writes).toBe(0);
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});
