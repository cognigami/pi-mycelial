import { createHash } from "node:crypto";
import {
  type HerdrAgentName,
  herdrAgentName,
  type RoleId,
  type SessionId,
} from "./identifiers";

/**
 * Derive a stable Herdr-global live-agent identity for one prepared Pi session.
 * The readable prefix is diagnostic only; the session digest supplies isolation
 * across missions that use the same participant roles.
 */
export function deriveHerdrAgentName(
  role: RoleId,
  session: SessionId
): HerdrAgentName {
  const rolePrefix = String(role)
    .toLowerCase()
    .replaceAll(".", "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 8)
    .replace(/[-_]+$/g, "");
  const digest = createHash("sha256")
    .update(String(session))
    .digest("hex")
    .slice(0, 20);
  return herdrAgentName(`m-${rolePrefix || "role"}-${digest}`);
}
