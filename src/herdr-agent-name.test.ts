import { expect, test } from "bun:test";
import { deriveHerdrAgentName } from "./herdr-agent-name";
import { roleId, sessionId } from "./identifiers";

test("derives stable Herdr-global names from participant sessions", () => {
  const first = deriveHerdrAgentName(
    roleId("Builder.One"),
    sessionId("session-one")
  );
  const repeated = deriveHerdrAgentName(
    roleId("Builder.One"),
    sessionId("session-one")
  );
  const otherMissionSession = deriveHerdrAgentName(
    roleId("Builder.One"),
    sessionId("session-two")
  );

  expect(first).toBe(repeated);
  expect(first).not.toBe(otherMissionSession);
  expect(first).toMatch(/^m-builder-[a-f0-9]{20}$/);
  expect(first.length).toBeLessThanOrEqual(32);
});
