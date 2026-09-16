import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFileSystem } from "./filesystem";
import { loadMission, readMissionDocument } from "./mission";

test("loads role launch metadata without coupling role identity to preset", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-mission-"));
  try {
    await writeFile(join(root, "mission.md"), "# Test mission\n");
    await writeFile(
      join(root, "agents.json"),
      JSON.stringify({
        coordinator: {},
        reviewer: { preset: "domain-auditor" },
      })
    );
    await writeFile(join(root, "repos.json"), '{"repos":["app"]}');

    const mission = await loadMission(nodeFileSystem, root);
    expect(mission.roles.map(String)).toEqual(["coordinator", "reviewer"]);
    expect(
      mission.agents.map((agent) => ({
        role: String(agent.role),
        ...(agent.preset === undefined ? {} : { preset: String(agent.preset) }),
      }))
    ).toEqual([
      { role: "coordinator" },
      { role: "reviewer", preset: "domain-auditor" },
    ]);
    expect(mission.repos.map(String)).toEqual(["app"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads bounded mission content through the validated mission root", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-mission-read-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "mission.md"), "1234567890");
    await writeFile(join(root, "agents.json"), '["coordinator"]');
    const mission = await loadMission(nodeFileSystem, root);

    expect(await readMissionDocument(nodeFileSystem, mission, 5)).toEqual({
      text: "12345",
      truncated: true,
      totalBytes: 10,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
