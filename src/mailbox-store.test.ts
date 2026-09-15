import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFileSystem } from "./filesystem";
import type { Clock, IdGenerator } from "./identifiers";
import { missionId, roleId, sessionId } from "./identifiers";
import { MailboxStore } from "./mailbox-store";
import { loadMission } from "./mission";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
class FixedClock implements Clock {
  constructor(public value = new Date("2026-01-01T00:00:00Z")) {}
  now() {
    return new Date(this.value);
  }
  tick() {
    this.value = new Date(this.value.getTime() + 1000);
  }
}
class Sequence implements IdGenerator {
  constructor(readonly values: string[]) {}
  next() {
    const value = this.values.shift();
    if (!value) throw new Error("no id");
    return value;
  }
}
const ids = [
  "01J8Z3K9QATG5V2N7X4R6M1B0C",
  "01J8Z3K9QATG5V2N7X4R6M1B0D",
  "01J8Z3K9QATG5V2N7X4R6M1B0E",
  "01J8Z3K9QATG5V2N7X4R6M1B0F",
  "01J8Z3K9QATG5V2N7X4R6M1B0G",
];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mycelial-mail-"));
  roots.push(root);
  await writeFile(join(root, "mission.md"), "# Test\n");
  await writeFile(
    join(root, "agents.json"),
    JSON.stringify(["coordinator", "implementer", "reviewer"])
  );
  await writeFile(join(root, "repos.json"), JSON.stringify(["core"]));
  const mission = await loadMission(nodeFileSystem, root);
  const clock = new FixedClock();
  const sequence = new Sequence([...ids]);
  const store = new MailboxStore(nodeFileSystem, mission, clock, sequence, {
    messageMaxBytes: 4096,
    readLimit: 10,
    readMaxBytes: 16384,
  });
  return { root, mission, clock, sequence, store };
}
const identity = (role: string, session: string) => ({
  mission: missionId("test"),
  role: roleId(role),
  session: sessionId(session),
});
describe("mailbox workflow", () => {
  test("send, independent read, receipt, and linked reply", async () => {
    const { store } = await fixture();
    const sent = await store.send(identity("coordinator", "c1"), {
      to: "all",
      body: "work",
      repo: "core",
      requires_ack: true,
    });
    expect(sent.message.recipients.map(String)).toEqual([
      "implementer",
      "reviewer",
    ]);
    const first = await store.read(identity("implementer", "i1"));
    const second = await store.read(identity("implementer", "i2"));
    expect(first.messages.map((m) => m.id)).toEqual([sent.message.id]);
    expect(second.messages.map((m) => m.id)).toEqual([sent.message.id]);
    expect(
      (await store.read(identity("implementer", "i1"))).messages
    ).toHaveLength(0);
    const receipt = await store.acknowledge(identity("implementer", "i1"), {
      message: sent.message.id,
      event: "accepted",
      note: "on it",
    });
    expect((await store.receipts(sent.message.id))[0]).toEqual(receipt);
    const reply = await store.reply(identity("implementer", "i1"), {
      message: sent.message.id,
      body: "done",
    });
    expect(reply.message.recipients.map(String)).toEqual(["coordinator"]);
    expect(reply.message.in_reply_to).toBe(sent.message.id);
    expect(reply.message.thread).toBe(sent.message.id);
  });
  test("repairs partial fan-out and discovers delayed lower ULID", async () => {
    const { store, mission, clock, sequence } = await fixture();
    const newer = await store.send(identity("coordinator", "c1"), {
      to: "implementer",
      body: "newer",
    });
    await store.read(identity("implementer", "i1"));
    sequence.values.unshift("01J8Z3K9QATG5V2N7X4R6M1B00");
    clock.tick();
    const delayed = await store.send(identity("coordinator", "c1"), {
      to: "implementer",
      body: "delayed",
    });
    await unlink(
      mission.paths.marker(roleId("implementer"), delayed.message.id)
    );
    const read = await store.read(identity("implementer", "i1"));
    expect(read.messages.map((m) => m.id)).toEqual([delayed.message.id]);
    expect(newer.message.id > delayed.message.id).toBeTrue();
  });
  test("rejects generated-directory symlinks", async () => {
    const { root, store } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "mycelial-outside-"));
    roots.push(outside);
    await mkdir(join(root, "messages"), { recursive: true });
    await rm(join(root, "messages"), { recursive: true });
    await symlink(outside, join(root, "messages"));
    await expect(
      store.send(identity("coordinator", "c1"), {
        to: "implementer",
        body: "unsafe",
      })
    ).rejects.toThrow("unsafe");
  });
});
