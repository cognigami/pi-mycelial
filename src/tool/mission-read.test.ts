import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config";
import { nodeFileSystem } from "../filesystem";
import { loadMission } from "../mission";
import { createMissionReadTool } from "./mission-read";
import type { ToolServices } from "./services";

test("reads only the trusted bound mission path with bounded output", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-mission-tool-"));
  try {
    await writeFile(join(root, "mission.md"), "1234567890");
    await writeFile(join(root, "agents.json"), '["coordinator"]');
    const mission = await loadMission(nodeFileSystem, root);
    const services = {
      mailbox: { fs: nodeFileSystem, mission },
      config: { ...DEFAULT_CONFIG, readMaxBytes: 5 },
    } as unknown as ToolServices;
    const tool = createMissionReadTool(services);

    const result = await tool.execute(
      "tool-call",
      {},
      new AbortController().signal,
      undefined,
      {} as never
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "12345\n\n[mission.md truncated: showing 5 of 10 bytes]",
      },
    ]);
    expect(result.details).toEqual({
      text: "12345",
      truncated: true,
      totalBytes: 10,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
