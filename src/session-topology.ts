import { isAbsolute } from "node:path";
import {
  type RoleId,
  roleId,
  type SessionId,
  sessionId,
  ValidationError,
} from "./identifiers";
import type { Participant } from "./participants";

export interface ParticipantSession {
  sessionId: SessionId;
  sessionFile: string;
  name: string;
  parent: RoleId | null;
}

export interface SessionManifestV1 {
  formatVersion: 1;
  sessions: Record<string, ParticipantSession>;
}

export function validateSessionTopology(
  manifest: SessionManifestV1,
  participants: readonly Participant[]
): void {
  if (manifest.formatVersion !== 1)
    throw new ValidationError("Unsupported sessions.json format version");
  const expected = new Set(participants.map((participant) => participant.role));
  const actual = Object.keys(manifest.sessions).map(roleId);
  if (
    actual.length !== expected.size ||
    actual.some((participant) => !expected.has(participant))
  )
    throw new ValidationError(
      "sessions.json participants must exactly match agents.json"
    );

  const coordinator = expected.has(roleId("coordinator"));
  for (const participant of actual) {
    const session = manifest.sessions[participant];
    sessionId(session.sessionId);
    if (!isAbsolute(session.sessionFile))
      throw new ValidationError("Session file paths must be absolute");
    if (session.name.length === 0)
      throw new ValidationError("Session names must be non-empty");
    const expectedParent =
      coordinator && participant !== "coordinator"
        ? roleId("coordinator")
        : null;
    if (session.parent !== expectedParent)
      throw new ValidationError(
        `Invalid session parent for participant ${participant}`
      );
  }
}
