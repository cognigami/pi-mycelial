import { expect, test } from "bun:test";
import { parseMycelialCommand } from "./command";

test("parses existing initialization arguments and quoted source paths", () => {
  expect(
    parseMycelialCommand(
      'init release-42 --roles coordinator,reviewer --from "docs/release mission.md" --repos app,shared'
    )
  ).toEqual({
    action: "init",
    mission: "release-42",
    participants: [
      { role: "coordinator", capability: "coordinator" },
      { role: "reviewer", capability: "reviewer" },
    ],
    source: "docs/release mission.md",
    repos: ["app", "shared"],
    includeCoordinator: true,
  });
});

test("normalizes quoted multiplicity declarations to unique participants", () => {
  expect(
    parseMycelialCommand(
      "init parallel-build --roles 'builder=2, reviewer=1' --from 'docs/build plan.md'"
    )
  ).toEqual({
    action: "init",
    mission: "parallel-build",
    participants: [
      { role: "coordinator", capability: "coordinator" },
      { role: "builder-1", capability: "builder" },
      { role: "builder-2", capability: "builder" },
      { role: "reviewer", capability: "reviewer" },
    ],
    source: "docs/build plan.md",
    includeCoordinator: true,
  });
});

test("parses coordinator opt-out with existing singleton syntax", () => {
  expect(
    parseMycelialCommand(
      "init peer-review --roles builder,reviewer --no-coordinator"
    )
  ).toEqual({
    action: "init",
    mission: "peer-review",
    participants: [
      { role: "builder", capability: "builder" },
      { role: "reviewer", capability: "reviewer" },
    ],
    includeCoordinator: false,
  });
});

test.each([
  "init release-42 --roles builder=0",
  "init release-42 --roles builder=2,builder-1",
  "init release-42 --roles builder,builder=2",
  "init release-42 --roles coordinator=2",
])("rejects invalid or colliding multiplicity declaration: %s", (input) => {
  expect(() => parseMycelialCommand(input)).toThrow();
});

test("requires explicit mission roles", () => {
  expect(() => parseMycelialCommand("init release-42")).toThrow(
    "requires --roles"
  );
});

test("returns command help for an empty invocation", () => {
  expect(parseMycelialCommand("")).toEqual({ action: "help" });
});
