import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFileSystem } from "./filesystem";
import type { Clock } from "./identifiers";
import { missionId, roleId, sessionId, taskId } from "./identifiers";
import { formatJson } from "./json-codec";
import { loadMission } from "./mission";
import { ProjectionStore } from "./projections";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))
  );
});
class ClockStub implements Clock {
  constructor(public millis = Date.parse("2026-01-01T00:00:00Z")) {}
  now() {
    return new Date(this.millis);
  }
}
const identity = (role: string, session: string) => ({
  mission: missionId("test"),
  role: roleId(role),
  session: sessionId(session),
});
async function fixture(alive?: (pid: number) => boolean) {
  const root = await mkdtemp(join(tmpdir(), "mycelial-claim-"));
  roots.push(root);
  await writeFile(join(root, "mission.md"), "# test\n");
  await writeFile(join(root, "agents.json"), JSON.stringify(["one", "two"]));
  const mission = await loadMission(nodeFileSystem, root);
  const clock = new ClockStub();
  const options = {
    retries: 0,
    backoffMs: 1,
    isProcessAlive: alive,
    minLeaseMs: 100,
    maxLeaseMs: 10_000,
  };
  return {
    root,
    mission,
    clock,
    store: new ProjectionStore(nodeFileSystem, mission, clock, options),
    options,
  };
}
describe("claims and roster", () => {
  test("one owner wins, renews, expires, transfers, and releases", async () => {
    const { store, clock } = await fixture();
    const one = identity("one", "s1");
    const two = identity("two", "s2");
    const outcomes = await Promise.all([
      store.claim(one, "task-a", 1000),
      store.claim(two, "task-a", 1000),
    ]);
    expect(outcomes.filter((x) => x.outcome === "claimed")).toHaveLength(1);
    const winner = outcomes.find((x) => x.outcome === "claimed")?.claim;
    if (!winner) throw new Error("missing winner");
    const winnerIdentity = winner.agent === one.role ? one : two;
    const loserIdentity = winner.agent === one.role ? two : one;
    const renewed = await store.claim(winnerIdentity, "task-a", 1000);
    expect(renewed.outcome).toBe("renewed");
    expect(renewed.claim?.version).toBe(2);
    expect((await store.release(loserIdentity, "task-a")).outcome).toBe(
      "rejected"
    );
    clock.millis += 1001;
    const takeover = await store.claim(loserIdentity, "task-a", 1000);
    expect(takeover.outcome).toBe("taken-over");
    expect(takeover.claim?.observed_prior_version).toBe(2);
    expect((await store.release(loserIdentity, "task-a")).outcome).toBe(
      "released"
    );
  });
  test("recovers only a proven-dead lock", async () => {
    const { mission, clock, options } = await fixture(() => false);
    const lock = mission.paths.lock(taskId("task-dead"));
    await mkdir(lock, { recursive: true });
    await writeFile(
      join(lock, "owner.json"),
      formatJson({
        formatVersion: 1,
        token: "00000000-0000-4000-8000-000000000000",
        pid: 999999,
        session: "dead-session",
        acquired: clock.now().toISOString(),
      })
    );
    const store = new ProjectionStore(nodeFileSystem, mission, clock, options);
    expect(
      (await store.claim(identity("one", "s1"), "task-dead", 1000)).outcome
    ).toBe("claimed");
    const liveLock = mission.paths.lock(taskId("task-live"));
    await mkdir(liveLock, { recursive: true });
    await writeFile(
      join(liveLock, "owner.json"),
      formatJson({
        formatVersion: 1,
        token: "00000000-0000-4000-8000-000000000001",
        pid: process.pid,
        session: "live-session",
        acquired: clock.now().toISOString(),
      })
    );
    const liveStore = new ProjectionStore(nodeFileSystem, mission, clock, {
      ...options,
      isProcessAlive: () => true,
    });
    expect(
      (await liveStore.claim(identity("one", "s1"), "task-live", 1000)).outcome
    ).toBe("contended");
  });
  test("keeps sessions visible independently", async () => {
    const { store } = await fixture();
    await store.heartbeat(identity("one", "s1"), 1000);
    await store.heartbeat(identity("one", "s2"), 1000);
    expect((await store.roster()).map((r) => String(r.session))).toEqual([
      "s1",
      "s2",
    ]);
  });
});
