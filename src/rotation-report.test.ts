import { expect, test } from "bun:test";
import { join } from "node:path";
import { roleId, sessionId } from "./identifiers";
import type { RotationReport } from "./mission-rotation";
import { MissionPaths } from "./paths";
import { formatRotationReport } from "./rotation-cli";
import type { VerifiedSession } from "./session-discovery";

function file(
  path: string,
  id: string,
  parentSession?: string
): VerifiedSession {
  const header = {
    type: "session" as const,
    version: 3,
    id,
    timestamp: "2026-10-10T00:00:00.000Z",
    cwd: "/project",
    ...(parentSession ? { parentSession } : {}),
  };
  return { path, header, headerLine: JSON.stringify(header) };
}

function report(): RotationReport {
  const coordinator = file("/sessions/project/coordinator.jsonl", "coord");
  const builder = file(
    "/sessions/project/builder.jsonl",
    "builder",
    coordinator.path
  );
  const reviewer = file(
    "/sessions/project/reviewer.jsonl",
    "reviewer",
    coordinator.path
  );
  const child = file("/sessions/other/child.jsonl", "child", builder.path);
  const grandchild = file("/external/child.jsonl", "grandchild", child.path);
  const roles = ["coordinator", "builder", "reviewer"].map(roleId);
  return {
    missionId: "mission",
    roles,
    roots: ["/sessions", "/external"],
    family: [grandchild, child, builder, reviewer, coordinator],
    unread: {},
    liveClaims: [],
    warnings: [],
    refusals: [],
    discoveryProblems: [],
    retention: false,
    controls: {},
    returned: {},
    mission: {
      paths: new MissionPaths("/missions/mission"),
      agents: [],
      roles,
      repos: [],
      sessions: {
        formatVersion: 1,
        sessions: Object.fromEntries(
          [coordinator, builder, reviewer].map((session, index) => [
            roles[index],
            {
              sessionId: sessionId(session.header.id),
              sessionFile: session.path,
              name: `mission: ${roles[index]}`,
              parent: index === 0 ? null : roleId("coordinator"),
            },
          ])
        ),
      },
    },
  };
}

test("report names managed sessions and labels direct/transitive descendants without guessing their names", () => {
  const input = report();
  const before = JSON.stringify(input);
  const output = formatRotationReport(input);
  expect(output).toContain("participants: 3; descendants: 2");
  expect(output).toContain("  mission: coordinator — coordinator.jsonl");
  expect(output).toContain("  mission: builder — builder.jsonl");
  expect(output).toContain("  mission: reviewer — reviewer.jsonl");
  expect(
    output.match(/ {2}Descendant of mission: builder — child\.jsonl/g)
  ).toHaveLength(2);
  expect(output).not.toContain("[grandchild]");
  expect(JSON.stringify(input)).toBe(before);
});

test("directory headings and filenames preserve the exact scope and children-first order across directories", () => {
  const input = report();
  const output = formatRotationReport(input);
  const paths: string[] = [];
  let directory = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("Sessions in "))
      directory = line.slice("Sessions in ".length, -1);
    else if (line.startsWith("  ") && line.includes(" — "))
      paths.push(join(directory, line.slice(line.indexOf(" — ") + 3)));
  }
  expect(paths).toEqual(input.family.map((session) => session.path));
  expect(output.match(/Sessions in \/sessions\/project:/g)).toHaveLength(1);
  expect(output).toContain("Delete LAST: 5 verified old session files");
});

test("only previews carry the dry-run note; retention, warnings, discovery failures and refusals remain visible", () => {
  const input = report();
  input.retention = true;
  input.warnings = ["Unread mail remains unread", "Downtime is not proven"];
  input.discoveryProblems = ["/external/unreadable.jsonl: unsafe header"];
  input.refusals = ["Incomplete discovery forbids deletion"];
  const preview = formatRotationReport(input, true);
  const mutation = formatRotationReport(input);
  expect(preview).toContain("Dry run only; nothing changed.");
  expect(preview).toContain("A real run repeats preflight");
  expect(mutation).not.toContain("Dry run");
  for (const output of [preview, mutation]) {
    expect(output).toContain("Retain: 5 verified old session files");
    expect(output).toContain("WARNING: Unread mail remains unread");
    expect(output).toContain("WARNING: Downtime is not proven");
    expect(output).toContain(
      "DISCOVERY INCOMPLETE: /external/unreadable.jsonl: unsafe header"
    );
    expect(output).toContain("REFUSED: Incomplete discovery forbids deletion");
  }
});

test("an incomplete preflight without a manifest still reports its refusal", () => {
  const input = report();
  input.mission = undefined;
  input.roles = [];
  input.family = [];
  input.refusals = ["Missing sessions.json"];
  expect(formatRotationReport(input, true)).toContain(
    "REFUSED: Missing sessions.json"
  );
});
