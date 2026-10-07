import { describe, expect, test } from "bun:test";
import {
  capabilityId,
  messageId,
  missionId,
  roleId,
  utcTimestamp,
} from "./identifiers";

describe("identifiers", () => {
  test("rejects unsafe path segments", () => {
    for (const value of ["", ".", "..", "a/b", "a\\b", "bad\nname", "name."])
      expect(() => missionId(value)).toThrow();
  });
  test("applies the same path-safe discipline to roles and capabilities", () => {
    expect(String(roleId("builder-1"))).toBe("builder-1");
    expect(String(capabilityId("builder"))).toBe("builder");
    for (const value of ["", "../builder", "builder/one", "builder."])
      expect(() => capabilityId(value)).toThrow();
  });
  test("validates ULIDs and UTC", () => {
    expect(messageId("01J8Z3K9QATG5V2N7X4R6M1B0C")).toBeTruthy();
    expect(() => messageId("not-an-id")).toThrow();
    expect(utcTimestamp("2026-01-01T00:00:00Z")).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });
});
