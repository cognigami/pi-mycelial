import { expect, test } from "bun:test";
import { parseMycelialCommand } from "./command";

test("parses mission initialization arguments and quoted draft paths", () => {
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
