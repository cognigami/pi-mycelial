import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishImmutable, replaceMutable } from "./atomic-files";
import { type FileSystem, nodeFileSystem } from "./filesystem";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))
  );
});
test("failed staged writes clean temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-atomic-fail-"));
  roots.push(root);
  const failing: FileSystem = {
    ...nodeFileSystem,
    async open(path, flags, mode) {
      const handle = await nodeFileSystem.open(path, flags, mode);
      return {
        async writeFile() {
          throw new Error("injected write failure");
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
  };
  await expect(
    publishImmutable(failing, join(root, "value"), Buffer.from("one"))
  ).rejects.toThrow("injected write failure");
  expect(await readdir(root)).toHaveLength(0);
});

test("immutable publication has one winner and cleans staging files", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-atomic-"));
  roots.push(root);
  const path = join(root, "value");
  const settled = await Promise.allSettled([
    publishImmutable(nodeFileSystem, path, Buffer.from("one")),
    publishImmutable(nodeFileSystem, path, Buffer.from("two")),
  ]);
  expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(["one", "two"]).toContain(await readFile(path, "utf8"));
  expect(
    (await readdir(root)).filter((name) => name.endsWith(".tmp"))
  ).toHaveLength(0);
  await replaceMutable(nodeFileSystem, path, Buffer.from("three"));
  expect(await readFile(path, "utf8")).toBe("three");
});
