import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFileSystem } from "./filesystem";
import { roleId } from "./identifiers";
import { loadMission, readMissionDocument, resolveRecipients } from "./mission";

async function withMission<T>(
  agents: unknown,
  run: (root: string) => Promise<T>
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "mycelial-mission-"));
  try {
    await writeFile(join(root, "mission.md"), "# Test mission\n");
    await writeFile(join(root, "agents.json"), JSON.stringify(agents));
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const normalizedAgents = (mission: Awaited<ReturnType<typeof loadMission>>) =>
  mission.agents.map((agent) => ({
    role: String(agent.role),
    capability: String(agent.capability),
    ...(agent.preset === undefined ? {} : { preset: String(agent.preset) }),
  }));

describe("agents.json compatibility", () => {
  test.each([
    {
      label: "bare string array",
      agents: ["coordinator", "reviewer"],
      expected: [
        { role: "coordinator", capability: "coordinator" },
        { role: "reviewer", capability: "reviewer" },
      ],
    },
    {
      label: "wrapped string array",
      agents: { agents: ["coordinator", "reviewer"] },
      expected: [
        { role: "coordinator", capability: "coordinator" },
        { role: "reviewer", capability: "reviewer" },
      ],
    },
    {
      label: "object-keyed entries and null metadata",
      agents: {
        coordinator: null,
        reviewer: { preset: "domain-auditor" },
      },
      expected: [
        { role: "coordinator", capability: "coordinator" },
        {
          role: "reviewer",
          capability: "reviewer",
          preset: "domain-auditor",
        },
      ],
    },
    {
      label: "wrapped object-keyed entries",
      agents: {
        agents: {
          coordinator: {},
          reviewer: { preset: "domain-auditor" },
        },
      },
      expected: [
        { role: "coordinator", capability: "coordinator" },
        {
          role: "reviewer",
          capability: "reviewer",
          preset: "domain-auditor",
        },
      ],
    },
    {
      label: "object entries using role or name",
      agents: [
        { role: "coordinator" },
        { name: "reviewer", preset: "domain-auditor" },
      ],
      expected: [
        { role: "coordinator", capability: "coordinator" },
        {
          role: "reviewer",
          capability: "reviewer",
          preset: "domain-auditor",
        },
      ],
    },
  ])(
    "loads $label and defaults capability to role",
    async ({ agents, expected }) => {
      await withMission(agents, async (root) => {
        const mission = await loadMission(nodeFileSystem, root);
        expect(normalizedAgents(mission)).toEqual(expected);
      });
    }
  );
});

test("loads generated participant records with explicit capabilities", async () => {
  await withMission(
    {
      agents: [
        { role: "coordinator", capability: "coordinator" },
        {
          role: "builder-1",
          capability: "builder",
          preset: "implementation",
        },
        { role: "builder-2", capability: "builder" },
      ],
    },
    async (root) => {
      await writeFile(join(root, "repos.json"), '{"repos":["app"]}');
      const mission = await loadMission(nodeFileSystem, root);
      expect(normalizedAgents(mission)).toEqual([
        {
          role: "builder-1",
          capability: "builder",
          preset: "implementation",
        },
        { role: "builder-2", capability: "builder" },
        { role: "coordinator", capability: "coordinator" },
      ]);
      expect(mission.repos.map(String)).toEqual(["app"]);
    }
  );
});

test.each([
  {
    label: "non-string capability",
    agents: [{ role: "builder-1", capability: 2 }],
  },
  {
    label: "unsafe capability",
    agents: [{ role: "builder-1", capability: "../builder" }],
  },
  {
    label: "conflicting role and name",
    agents: [{ role: "builder-1", name: "builder-2", capability: "builder" }],
  },
  {
    label: "keyed role contradiction",
    agents: {
      "builder-1": { role: "builder-2", capability: "builder" },
    },
  },
  {
    label: "duplicate role with contradictory capabilities",
    agents: [
      { role: "builder-1", capability: "builder" },
      { role: "builder-1", capability: "reviewer" },
    ],
  },
])("rejects $label", async ({ agents }) => {
  await withMission(agents, async (root) => {
    await expect(loadMission(nodeFileSystem, root)).rejects.toThrow();
  });
});

test("bounds diagnostics for malformed agent metadata", async () => {
  const untrusted = "x".repeat(20_000);
  await withMission({ [untrusted]: 7 }, async (root) => {
    let failure: unknown;
    try {
      await loadMission(nodeFileSystem, root);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : "";
    expect(message.length).toBeLessThan(512);
    expect(message).not.toContain("x".repeat(100));
  });
});

test("routes generated participants by role rather than capability", async () => {
  await withMission(
    {
      agents: [
        { role: "coordinator", capability: "coordinator" },
        { role: "builder-1", capability: "builder" },
        { role: "builder-2", capability: "builder" },
      ],
    },
    async (root) => {
      const mission = await loadMission(nodeFileSystem, root);
      expect(
        resolveRecipients(mission, roleId("coordinator"), "builder-1")
      ).toEqual({ to: "builder-1", recipients: ["builder-1"] });
      expect(resolveRecipients(mission, roleId("coordinator"), "all")).toEqual({
        to: "all",
        recipients: ["builder-1", "builder-2"],
      });
      expect(() =>
        resolveRecipients(mission, roleId("coordinator"), "builder")
      ).toThrow("Unknown recipient role: builder");
    }
  );
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
