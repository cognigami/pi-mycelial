import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFileSystem } from "./filesystem";
import {
  missionId,
  roleId,
  sessionId,
  systemClock,
  ulidGenerator,
} from "./identifiers";
import { MailboxStore } from "./mailbox-store";
import { loadMission } from "./mission";

/** Synthetic disposable mission copies only. No path option accepts live history. */
export async function benchmarkMailbox(
  sizes: readonly number[] = [100, 529, 1500],
  trials = 3
): Promise<unknown[]> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mycelial-synthetic-benchmark-"))
  );
  const rows: unknown[] = [];
  try {
    for (const count of sizes) {
      const seed = join(root, `seed-${count}`);
      await nodeFileSystem.mkdir(seed);
      await writeFile(join(seed, "mission.md"), "# Synthetic benchmark\n");
      await writeFile(join(seed, "agents.json"), '["coordinator","builder"]');
      const limits = {
        messageMaxBytes: 4096,
        readLimit: count + 1,
        readMaxBytes: 10_000_000,
      };
      const identity = (session: string) => ({
        mission: missionId("synthetic"),
        role: roleId("builder"),
        session: sessionId(session),
      });
      const seedStore = new MailboxStore(
        nodeFileSystem,
        await loadMission(nodeFileSystem, seed),
        systemClock,
        ulidGenerator,
        limits
      );
      for (let index = 0; index < count; index++)
        await seedStore.send(
          { ...identity("sender"), role: roleId("coordinator") },
          {
            to: "builder",
            body: `Synthetic bounded request ${index}. ${"x".repeat(256)}`,
          }
        );
      await seedStore.read(identity("warm"));
      for (const mode of ["preceding-republish", "warm-marker"] as const) {
        const destination = join(root, `${count}-${mode}`);
        await cp(seed, destination, { recursive: true });
        const mission = await loadMission(nodeFileSystem, destination);
        let stages = 0;
        let bypassMarkerHint = false;
        const fs = {
          ...nodeFileSystem,
          readdir: async (path: string) => {
            // Precisely isolate the old reconciliation behavior: every marker
            // gets an immutable publication attempt. Read still sees real markers.
            if (
              bypassMarkerHint &&
              path === mission.paths.inbox(roleId("builder"))
            ) {
              bypassMarkerHint = false;
              return [];
            }
            return nodeFileSystem.readdir(path);
          },
          open: async (...args: Parameters<typeof nodeFileSystem.open>) => {
            if (args[0].includes("/inbox/") && args[0].endsWith(".tmp"))
              stages++;
            return nodeFileSystem.open(...args);
          },
        };
        class MeasuredStore extends MailboxStore {
          override async reconcile(role?: ReturnType<typeof roleId>) {
            bypassMarkerHint = mode === "preceding-republish";
            try {
              return await super.reconcile(role);
            } finally {
              bypassMarkerHint = false;
            }
          }
        }
        const store = new MeasuredStore(
          fs,
          mission,
          systemClock,
          ulidGenerator,
          limits
        );
        for (const workload of [
          "warm-empty",
          "unread",
          "delayed-marker",
        ] as const) {
          const times: number[] = [];
          const publications: number[] = [];
          for (let trial = 0; trial < trials; trial++) {
            const reader =
              workload === "warm-empty"
                ? identity("warm")
                : identity(`${workload}-${trial}`);
            if (workload === "delayed-marker") {
              const names = await nodeFileSystem.readdir(
                mission.paths.inbox(reader.role)
              );
              const first = names[0];
              if (!first) throw new Error("Missing benchmark marker");
              await nodeFileSystem.unlink(
                join(mission.paths.inbox(reader.role), first)
              );
            }
            stages = 0;
            const start = performance.now();
            const result = await store.read(reader);
            times.push(performance.now() - start);
            publications.push(stages);
            if (
              result.messages.length !== (workload === "warm-empty" ? 0 : count)
            )
              throw new Error("Benchmark changed mailbox results");
          }
          rows.push({
            corpus: "synthetic",
            count,
            mode,
            workload,
            trials,
            medianMs: Number(
              times
                .sort((a, b) => a - b)
                [Math.floor(times.length / 2)]?.toFixed(2)
            ),
            markerStagesPerRead: publications,
          });
        }
      }
    }
    return rows;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
if (import.meta.main)
  console.log(
    JSON.stringify(
      {
        runtime: `Bun ${Bun.version}`,
        filesystem:
          "local disposable directories; OS cache warm after seed publication; no cache flushing",
        model: "none (storage-only)",
        rows: await benchmarkMailbox(),
      },
      null,
      2
    )
  );
