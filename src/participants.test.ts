import { describe, expect, test } from "bun:test";
import {
  expandParticipants,
  MAX_PARTICIPANTS_PER_CAPABILITY,
  normalizeParticipant,
  parseParticipantDeclaration,
} from "./participants";

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("participant declarations", () => {
  test.each([
    ["builder", { capability: "builder", count: 1 }],
    ["builder=1", { capability: "builder", count: 1 }],
    ["builder=3", { capability: "builder", count: 3 }],
  ])("parses %s", (input, expected) => {
    expect(plain(parseParticipantDeclaration(input))).toEqual(expected);
  });

  test.each([
    "",
    "builder=",
    "builder=0",
    "builder=-1",
    "builder=1.5",
    "builder=1=2",
    "builder=9007199254740992",
    `builder=${MAX_PARTICIPANTS_PER_CAPABILITY + 1}`,
    "coordinator=2",
  ])("rejects invalid declaration %s", (input) => {
    expect(() => parseParticipantDeclaration(input)).toThrow();
  });
});

describe("participant expansion", () => {
  test("expands counts in deterministic input order", () => {
    expect(plain(expandParticipants(["builder=3", "reviewer"]))).toEqual([
      { role: "coordinator", capability: "coordinator" },
      { role: "builder-1", capability: "builder" },
      { role: "builder-2", capability: "builder" },
      { role: "builder-3", capability: "builder" },
      { role: "reviewer", capability: "reviewer" },
    ]);
  });

  test("preserves singleton identity and explicit coordinator order", () => {
    expect(
      plain(expandParticipants(["reviewer", "coordinator", "builder=1"]))
    ).toEqual([
      { role: "reviewer", capability: "reviewer" },
      { role: "coordinator", capability: "coordinator" },
      { role: "builder", capability: "builder" },
    ]);
  });

  test("does not add a coordinator when opted out", () => {
    expect(
      plain(expandParticipants(["builder=2"], { includeCoordinator: false }))
    ).toEqual([
      { role: "builder-1", capability: "builder" },
      { role: "builder-2", capability: "builder" },
    ]);
  });

  test("keeps an explicitly declared coordinator when automatic inclusion is off", () => {
    expect(
      plain(
        expandParticipants(["coordinator", "builder"], {
          includeCoordinator: false,
        })
      )
    ).toEqual([
      { role: "coordinator", capability: "coordinator" },
      { role: "builder", capability: "builder" },
    ]);
  });

  test.each([
    [["builder", "builder=2"], "duplicate capabilities"],
    [["builder=2", "builder-1"], "derived participant collision"],
    [["all"], "reserved broadcast identity"],
    [[], "empty participant list"],
  ])("rejects %s (%s)", (declarations) => {
    expect(() => expandParticipants(declarations)).toThrow();
  });
});

test("normalizes participant metadata and defaults capability to identity", () => {
  expect(plain(normalizeParticipant({ role: "builder-1" }))).toEqual({
    role: "builder-1",
    capability: "builder-1",
  });
  expect(
    plain(
      normalizeParticipant({
        role: "builder-1",
        capability: "builder",
        preset: "implementation",
      })
    )
  ).toEqual({
    role: "builder-1",
    capability: "builder",
    preset: "implementation",
  });
});
