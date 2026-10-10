import { expect, test } from "bun:test";
import { sessionId } from "./identifiers";
import { resolveIdentity } from "./identity";

test("matching overrides and hostless callers remain supported; stale overrides fail", () => {
  expect(
    resolveIdentity(
      {
        flagMission: "m",
        flagRole: "r",
        flagSession: "s",
        hostSession: "s",
        env: {},
      },
      "/missions"
    )?.session
  ).toBe(sessionId("s"));
  expect(
    resolveIdentity(
      { flagMission: "m", flagRole: "r", flagSession: "s", env: {} },
      "/missions"
    )?.session
  ).toBe(sessionId("s"));
  expect(() =>
    resolveIdentity(
      {
        flagMission: "m",
        flagRole: "r",
        hostSession: "new",
        env: { PI_MYCELIAL_SESSION: "old" },
      },
      "/missions"
    )
  ).toThrow("does not match");
});

test("identity is inert unbound and flags override environment", () => {
  expect(resolveIdentity({ env: {} }, "/missions")).toBeUndefined();
  const identity = resolveIdentity(
    {
      flagMission: "flag-m",
      flagRole: "flag-r",
      hostSession: "host-s",
      env: { PI_MYCELIAL_MISSION: "env-m", PI_MYCELIAL_ROLE: "env-r" },
    },
    "/missions"
  );
  expect(String(identity?.mission)).toBe("flag-m");
  expect(String(identity?.role)).toBe("flag-r");
  expect(String(identity?.session)).toBe("host-s");
});
