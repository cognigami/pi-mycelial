import { expect, test } from "bun:test";
import { benchmarkMailbox } from "./mailbox-benchmark";

test("disposable benchmark isolates marker publications without changing read results", async () => {
  const rows = (await benchmarkMailbox([3], 1)) as Array<{
    mode: string;
    workload: string;
    markerStagesPerRead: number[];
  }>;
  expect(rows).toHaveLength(6);
  expect(
    rows
      .filter((row) => row.mode === "preceding-republish")
      .map((row) => row.markerStagesPerRead)
  ).toEqual([[3], [3], [3]]);
  expect(
    rows
      .filter((row) => row.mode === "warm-marker")
      .map((row) => row.markerStagesPerRead)
  ).toEqual([[0], [0], [1]]);
});
