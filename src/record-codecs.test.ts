import { describe, expect, test } from "bun:test";
import { formatClaim, parseClaim } from "./claim-codec";
import type { ClaimRecord, ReceiptRecord } from "./protocol";
import { formatReceipt, parseReceipt } from "./receipt-codec";

const receipt: ReceiptRecord = {
  formatVersion: 1,
  id: "01J8Z3K9QATG5V2N7X4R6M1B0D" as never,
  message: "01J8Z3K9QATG5V2N7X4R6M1B0C" as never,
  agent: "implementer" as never,
  session: "session-1" as never,
  event: "accepted",
  created: "2026-01-01T00:00:00.000Z",
  note: "working",
};
const claim: ClaimRecord = {
  formatVersion: 1,
  task: "task-a" as never,
  agent: "implementer" as never,
  session: "session-1" as never,
  status: "claimed",
  version: 2,
  expires: "2026-01-01T00:10:00.000Z",
  created: "2026-01-01T00:00:00.000Z",
  updated: "2026-01-01T00:01:00.000Z",
  observed_prior_version: 1,
};

describe("YAML record codecs", () => {
  test("round trip deterministically", () => {
    expect(parseReceipt(formatReceipt(receipt))).toEqual(receipt);
    expect(parseClaim(formatClaim(claim))).toEqual(claim);
    expect(formatReceipt(parseReceipt(formatReceipt(receipt)))).toBe(
      formatReceipt(receipt)
    );
    expect(formatClaim(parseClaim(formatClaim(claim)))).toBe(
      formatClaim(claim)
    );
  });
  test("reject extra and malformed fields with bounded path diagnostics", () => {
    expect(() =>
      parseReceipt(
        `${formatReceipt(receipt)}extra: secret\n`,
        "/receipts/event"
      )
    ).toThrow("/receipts/event");
    expect(() =>
      parseClaim(
        formatClaim(claim).replace("version: 2", "version: 0"),
        "/claims/task-a"
      )
    ).toThrow("/claims/task-a");
  });
});
