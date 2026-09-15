import { expect, test } from "bun:test";
import { resolveIdentity } from "./identity";

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
