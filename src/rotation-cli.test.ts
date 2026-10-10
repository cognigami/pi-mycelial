import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseRotationArgs, requireOperatorShell } from "./rotation-cli";

// Refuse a missing flag before invoking real Bun, so even a regressed recipe
// cannot install packages or use the network in these disposable tests.
const operatorBunStub = `#!/bin/sh
if [ "$1" = "../pi-extension-kit/scripts/tooling.ts" ]; then
  printf installed > "$INSTALLER"
  printf installed > node_modules/.pi-extension-kit-sync.sha256
  exit 0
fi
[ "$1" = "--no-install" ] || { printf 'required --no-install flag missing\\n' >&2; exit 78; }
no_install="$1"
shift
[ "$1" = "src/rotation-cli.ts" ] || exit 79
shift
exec "$REAL_BUN" "$no_install" "$REAL_CLI" "$@"
`;

test("operator CLI accepts only explicit mission directories and supported policies", () => {
  expect(
    parseRotationArgs([
      "--mission-dir",
      "/missions/m",
      "--dry-run",
      "--save-history",
    ])
  ).toMatchObject({
    missionDirectory: "/missions/m",
    dryRun: true,
    saveHistory: true,
  });
  for (const args of [
    [],
    ["--mission-dir", "relative"],
    ["--mission-dir", "/missions/m", "--yes"],
    ["--mission-dir", "/missions/m", "--recover", "--save-history"],
    ["--mission-dir", "/missions/m", "--dry-run", "--dry-run"],
  ])
    expect(() => parseRotationArgs(args)).toThrow();
  expect(() => requireOperatorShell({}, false)).toThrow("interactive");
  expect(() => requireOperatorShell({ PI_SESSION_ID: "agent" }, true)).toThrow(
    "operator control shell"
  );
  expect(() => requireOperatorShell({}, true)).not.toThrow();
});

test.each(
  ["absent", "stale"].flatMap((stamp) =>
    ["dry-run", "refused-mutation"].map((invocation) => ({ stamp, invocation }))
  )
)(
  "supported rotate entry $invocation with $stamp sync stamp never installs or writes setup state",
  async ({ stamp, invocation }) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mycelial-rotate-entry-"))
    );
    try {
      const checkout = join(root, "pi-mycelial");
      const bin = join(root, "bin");
      await mkdir(join(checkout, "node_modules"), { recursive: true });
      await mkdir(bin);
      await mkdir(join(root, "pi-extension-kit", "scripts"), {
        recursive: true,
      });
      await writeFile(
        join(checkout, "Justfile"),
        await readFile(resolve("Justfile"))
      );
      await writeFile(
        join(root, "pi-extension-kit", "scripts", "tooling.ts"),
        "// disposable sync stub\n"
      );
      const stampPath = join(
        checkout,
        "node_modules",
        ".pi-extension-kit-sync.sha256"
      );
      if (stamp === "stale") await writeFile(stampPath, "stale\n");
      const installer = join(root, "installer-invoked");
      await writeFile(join(bin, "bun"), operatorBunStub, { mode: 0o700 });
      const args = [
        "--justfile",
        join(checkout, "Justfile"),
        "rotate",
        "--mission-dir",
        join(root, "missing-mission"),
      ];
      if (invocation === "dry-run") args.push("--dry-run");
      let failure: unknown;
      try {
        await promisify(execFile)("just", args, {
          cwd: checkout,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            INSTALLER: installer,
            REAL_BUN: process.execPath,
            REAL_CLI: resolve("src/rotation-cli.ts"),
          },
          timeout: 10_000,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 1 });
      const output = failure as { stdout: string; stderr: string };
      expect(
        invocation === "dry-run" ? output.stdout : output.stderr
      ).toContain(
        invocation === "dry-run" ? "REFUSED:" : "interactive operator TTY"
      );
      await expect(readFile(installer)).rejects.toMatchObject({
        code: "ENOENT",
      });
      if (stamp === "absent")
        await expect(readFile(stampPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      else expect(await readFile(stampPath, "utf8")).toBe("stale\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.each(["dry-run", "refused-mutation"])(
  "supported rotate %s refuses missing dependencies without creating node_modules or invoking installation",
  async (invocation) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mycelial-rotate-no-install-"))
    );
    try {
      const checkout = join(root, "pi-mycelial");
      const bin = join(root, "bin");
      await mkdir(join(checkout, "src"), { recursive: true });
      await mkdir(bin);
      await writeFile(
        join(checkout, "Justfile"),
        await readFile(resolve("Justfile"))
      );
      const dependency = "mycelial-rotation-missing-dependency-fixture";
      await writeFile(
        join(checkout, "package.json"),
        JSON.stringify({
          name: "rotation-no-install-fixture",
          type: "module",
          dependencies: { [dependency]: "1.0.0" },
        })
      );
      const cli = join(checkout, "src", "rotation-cli.ts");
      const marker = join(root, "unexpected-cli-execution");
      await writeFile(
        cli,
        `import "${dependency}";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.IMPORT_MARKER!, "executed");\n`
      );
      const installer = join(root, "installer-invoked");
      await writeFile(join(bin, "bun"), operatorBunStub, { mode: 0o700 });
      const args = [
        "--justfile",
        join(checkout, "Justfile"),
        "rotate",
        "--mission-dir",
        join(root, "missing-mission"),
      ];
      if (invocation === "dry-run") args.push("--dry-run");
      let failure: unknown;
      try {
        await promisify(execFile)("just", args, {
          cwd: checkout,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            INSTALLER: installer,
            REAL_BUN: process.execPath,
            REAL_CLI: cli,
            IMPORT_MARKER: marker,
          },
          timeout: 10_000,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 1 });
      expect((failure as { stderr: string }).stderr).toContain(
        `Cannot find package '${dependency}'`
      );
      for (const path of [
        installer,
        marker,
        join(checkout, "node_modules"),
        join(checkout, "bun.lock"),
        join(checkout, "bun.lockb"),
      ]) {
        await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
