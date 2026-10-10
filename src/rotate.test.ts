import { expect, test } from "bun:test";
import { resolveInstalledRotationArgs, runInstalledRotation } from "./rotate";

const directory = "/disposable/mission";

test("installed CLI forwards explicit directories and policy to the existing strict parser", async () => {
  for (const policy of [[], ["--dry-run", "--save-history"], ["--recover"]]) {
    const args = ["--mission-dir", directory, ...policy];
    expect(await resolveInstalledRotationArgs(args)).toEqual(args);
  }
});

test("installed CLI rejects ambiguous inputs, traversal, unsupported flags and policies before config loading", async () => {
  for (const args of [
    [],
    ["--mission-dir"],
    ["--mission-dir", "relative"],
    ["mission", "--mission-dir", directory],
    ["--mission-dir", directory, "mission"],
    ["one", "two"],
    ["../escape"],
    ["nested/id"],
    ["nested\\id"],
    [".."],
    ["."],
    ["bad id"],
    ["a".repeat(129)],
    ["mission", "--yes"],
    ["mission", "--dry-run", "--dry-run"],
    ["mission", "--recover", "--dry-run"],
    ["mission", "--recover", "--save-history"],
    ["--mission-dir", directory, "--mission-dir", directory],
  ]) {
    await expect(resolveInstalledRotationArgs(args)).rejects.toThrow();
  }
  await expect(runInstalledRotation(["--help", "--yes"])).rejects.toThrow();
});
