import { expect, test } from "bun:test";
import { parseMycelialCommand } from "./command";

test("parses mission initialization arguments and quoted source paths", () => {
  expect(
    parseMycelialCommand(
      'init release-42 --roles coordinator,reviewer --from "docs/release mission.md" --repos app,shared'
    )
  ).toEqual({
    action: "init",
    mission: "release-42",
    roles: ["coordinator", "reviewer"],
    source: "docs/release mission.md",
    repos: ["app", "shared"],
    includeCoordinator: true,
  });
});

test("parses coordinator opt-out", () => {
  expect(
    parseMycelialCommand(
      "init peer-review --roles builder,reviewer --no-coordinator"
    )
  ).toEqual({
    action: "init",
    mission: "peer-review",
    roles: ["builder", "reviewer"],
    includeCoordinator: false,
  });
});

test("requires explicit mission roles", () => {
  expect(() => parseMycelialCommand("init release-42")).toThrow(
    "requires --roles"
  );
});

test("returns command help for an empty invocation", () => {
  expect(parseMycelialCommand("")).toEqual({ action: "help" });
});
