import { dirname, isAbsolute, normalize, resolve } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  type SessionEntry,
  type SessionHeader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { publishImmutable } from "./atomic-files";
import type { FileSystem } from "./filesystem";
import {
  missionId,
  type RoleId,
  roleId,
  type SessionId,
  sessionId,
  ValidationError,
} from "./identifiers";
import type { Participant } from "./participants";

const MANIFEST_FIELDS = new Set(["formatVersion", "sessions"]);
const SESSION_FIELDS = new Set(["sessionId", "sessionFile", "name", "parent"]);
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_JSON_DEPTH = 100;
const MAX_DORMANT_SESSION_BYTES = 64 * 1024;

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

export interface PrepareSessionTopologyInput {
  cwd: string;
  sessionDir?: string;
  mission: unknown;
  participants: readonly Participant[];
}

interface PreparedSessionFile {
  participant: RoleId;
  bytes: Uint8Array;
}

export interface PreparedSessionTopology {
  readonly cwd: string;
  readonly sessionDir: string;
  readonly participants: readonly Participant[];
  readonly manifest: SessionManifestV1;
  /** Package implementation detail consumed by materializeSessionTopology. */
  readonly files: readonly PreparedSessionFile[];
}

export interface MaterializedSessionTopology {
  /** Exact session files created by this invocation, in publication order. */
  createdPaths: string[];
}

export class SessionMaterializationError extends Error {
  readonly code = "SESSION_MATERIALIZATION_FAILED";
  readonly createdPaths: string[];

  constructor(createdPaths: readonly string[], cause: unknown) {
    super("Failed to materialize dormant session topology", { cause });
    this.name = "SessionMaterializationError";
    this.createdPaths = [...createdPaths];
  }
}

export interface ValidateMaterializedSessionInput {
  session: ParticipantSession;
  cwd: string;
  parentSessionFile: string | null;
  sessionDir?: string;
}

export function validateSessionTopology(
  manifest: SessionManifestV1,
  participants: readonly Participant[]
): void {
  const root = requireObject(manifest, "sessions.json");
  requireExactFields(root, MANIFEST_FIELDS, "sessions.json");
  if (root.formatVersion !== 1)
    throw new ValidationError("Unsupported sessions.json format version");
  const sessions = requireObject(root.sessions, "sessions.json sessions");

  const participantRoles = participants.map((participant) =>
    roleId(participant.role)
  );
  if (new Set(participantRoles).size !== participantRoles.length)
    throw new ValidationError("Mission participants must be unique");
  const expected = new Set<RoleId>(participantRoles);
  const actual = Object.keys(sessions).map(roleId);
  if (
    actual.length !== expected.size ||
    actual.some((participant) => !expected.has(participant))
  )
    throw new ValidationError(
      "sessions.json participants must exactly match agents.json"
    );

  const coordinator = expected.has(roleId("coordinator"));
  const sessionIds = new Set<SessionId>();
  const sessionFiles = new Set<string>();
  for (const participant of actual) {
    const value = requireObject(
      sessions[participant],
      `session for participant ${participant}`
    );
    requireExactFields(value, SESSION_FIELDS, "participant session");
    const parsedSessionId = sessionId(value.sessionId);
    if (sessionIds.has(parsedSessionId))
      throw new ValidationError("Session IDs must be unique");
    sessionIds.add(parsedSessionId);

    const sessionFile = requireSafeAbsolutePath(value.sessionFile);
    if (sessionFiles.has(sessionFile))
      throw new ValidationError("Session file paths must be unique");
    sessionFiles.add(sessionFile);

    if (typeof value.name !== "string" || value.name.length === 0)
      throw new ValidationError("Session names must be non-empty");
    const parent = value.parent === null ? null : roleId(value.parent);
    const expectedParent =
      coordinator && participant !== "coordinator"
        ? roleId("coordinator")
        : null;
    if (parent !== expectedParent)
      throw new ValidationError(
        `Invalid session parent for participant ${participant}`
      );
  }
}

export function parseSessionManifest(
  text: string,
  participants: readonly Participant[]
): SessionManifestV1 {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_MANIFEST_BYTES)
    throw new ValidationError("sessions.json exceeds the supported size");
  let parsed: unknown;
  try {
    assertNoDuplicateJsonFields(text);
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("sessions.json must contain valid JSON");
  }
  validateSessionTopology(parsed as SessionManifestV1, participants);
  return normalizeManifest(parsed as SessionManifestV1);
}

export function serializeSessionManifest(
  manifest: SessionManifestV1,
  participants: readonly Participant[]
): string {
  validateSessionTopology(manifest, participants);
  return `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`;
}

/**
 * Constructs stable public Pi session records without writing their JSONL files.
 * SessionManager.create may create the selected session directory, as Pi normally
 * does, but no session destination is published until materialization.
 */
export function prepareSessionTopology(
  input: PrepareSessionTopologyInput
): PreparedSessionTopology {
  const mission = missionId(input.mission);
  if (typeof input.cwd !== "string" || input.cwd.includes("\0"))
    throw new ValidationError("Repository cwd must be a safe path");
  const cwd = resolve(input.cwd);
  if (input.sessionDir !== undefined)
    requireSafeAbsolutePath(input.sessionDir, "Session directory");

  const participants = [...input.participants];
  const roles = participants.map((participant) => roleId(participant.role));
  if (roles.length === 0 || new Set(roles).size !== roles.length)
    throw new ValidationError(
      "Mission participants must be non-empty and unique"
    );
  const coordinator = participants.find(
    (participant) => participant.role === "coordinator"
  );
  const ordered = coordinator
    ? [
        coordinator,
        ...participants.filter(
          (participant) => participant.role !== "coordinator"
        ),
      ]
    : participants;

  const sessions: Record<string, ParticipantSession> = Object.create(null);
  const files: PreparedSessionFile[] = [];
  let coordinatorFile: string | undefined;
  let selectedSessionDir: string | undefined;

  for (const participant of ordered) {
    const parent =
      coordinator && participant.role !== "coordinator"
        ? coordinator.role
        : null;
    const manager = SessionManager.create(cwd, input.sessionDir, {
      ...(parent === null ? {} : { parentSession: coordinatorFile }),
    });
    const name = `${mission}: ${participant.role}`;
    manager.appendSessionInfo(name);
    const header = manager.getHeader();
    const sessionFile = manager.getSessionFile();
    if (!header || !sessionFile)
      throw new Error("Pi did not prepare a persistent session");
    if (parent !== null && !coordinatorFile)
      throw new Error("Coordinator session must be prepared before workers");

    selectedSessionDir ??= manager.getSessionDir();
    const record: ParticipantSession = {
      sessionId: sessionId(manager.getSessionId()),
      sessionFile: requireSafeAbsolutePath(sessionFile),
      name,
      parent,
    };
    sessions[participant.role] = record;
    files.push({
      participant: participant.role,
      bytes: encodePublicSession(header, manager.getEntries()),
    });
    if (participant.role === "coordinator") coordinatorFile = sessionFile;
  }

  const manifest: SessionManifestV1 = { formatVersion: 1, sessions };
  validateSessionTopology(manifest, participants);
  return {
    cwd,
    sessionDir: selectedSessionDir as string,
    participants,
    manifest,
    files,
  };
}

export async function materializeSessionTopology(
  fs: FileSystem,
  prepared: PreparedSessionTopology
): Promise<MaterializedSessionTopology> {
  validateSessionTopology(prepared.manifest, prepared.participants);
  const createdPaths: string[] = [];
  try {
    for (const file of prepared.files) {
      const session = prepared.manifest.sessions[file.participant];
      if (!session)
        throw new ValidationError(
          "Prepared session files must exactly match the manifest"
        );
      const expectedParentFile =
        session.parent === null
          ? null
          : prepared.manifest.sessions[session.parent]?.sessionFile;
      if (session.parent !== null && !expectedParentFile)
        throw new ValidationError("Session parent is absent from the manifest");
      if (expectedParentFile) {
        const parentStat = await fs.lstat(expectedParentFile);
        if (!parentStat.isFile() || parentStat.isSymbolicLink())
          throw new ValidationError(
            "Session parent must be an existing regular non-symlink file"
          );
      }

      const result = await publishImmutable(
        fs,
        session.sessionFile,
        file.bytes
      );
      if (result === "created") createdPaths.push(session.sessionFile);
      await validateMaterializedSession(fs, {
        session,
        cwd: prepared.cwd,
        parentSessionFile: expectedParentFile ?? null,
        sessionDir: prepared.sessionDir,
      });
    }
    if (
      prepared.files.length !== Object.keys(prepared.manifest.sessions).length
    )
      throw new ValidationError(
        "Prepared session files must exactly match the manifest"
      );
    return { createdPaths };
  } catch (error) {
    throw new SessionMaterializationError(createdPaths, error);
  }
}

export async function validateMaterializedSessionTopology(
  fs: FileSystem,
  manifest: SessionManifestV1,
  participants: readonly Participant[],
  cwd: string
): Promise<void> {
  validateSessionTopology(manifest, participants);
  const expectedCwd = resolve(cwd);
  const coordinatorFile = manifest.sessions.coordinator?.sessionFile;
  for (const participant of participants) {
    const session = manifest.sessions[participant.role];
    await validateMaterializedSession(fs, {
      session,
      cwd: expectedCwd,
      parentSessionFile: session.parent === null ? null : coordinatorFile,
      sessionDir: dirname(session.sessionFile),
    });
  }
}

/** Opens and verifies a dormant session without appending any entry. */
export async function validateMaterializedSession(
  fs: FileSystem,
  input: ValidateMaterializedSessionInput
): Promise<void> {
  const path = requireSafeAbsolutePath(input.session.sessionFile);
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new ValidationError(
      "Session path must be a regular non-symlink file"
    );
  const bytes = await fs.readFile(path);
  if (bytes.byteLength > MAX_DORMANT_SESSION_BYTES)
    throw new ValidationError(
      "Dormant session file exceeds the supported size"
    );
  const entries = parseDormantSessionJsonl(bytes.toString("utf8"));
  const header = entries[0] as SessionHeader;
  const info = entries[1] as SessionEntry;
  const expectedCwd = resolve(input.cwd);
  const expectedParent = input.parentSessionFile ?? undefined;
  if (
    header.id !== input.session.sessionId ||
    header.cwd !== expectedCwd ||
    header.parentSession !== expectedParent ||
    info.type !== "session_info" ||
    info.name !== input.session.name
  )
    throw new ValidationError("Materialized session metadata does not match");

  const manager = SessionManager.open(path, input.sessionDir ?? dirname(path));
  const reopenedEntries = manager.getEntries();
  if (
    manager.getSessionFile() !== path ||
    manager.getSessionId() !== input.session.sessionId ||
    manager.getCwd() !== expectedCwd ||
    manager.getSessionName() !== input.session.name ||
    manager.getHeader()?.parentSession !== expectedParent ||
    reopenedEntries.length !== 1 ||
    reopenedEntries[0]?.type !== "session_info" ||
    manager.buildSessionContext().messages.length !== 0
  )
    throw new ValidationError(
      "Materialized session failed public Pi validation"
    );
}

function encodePublicSession(
  header: SessionHeader,
  entries: readonly SessionEntry[]
): Uint8Array {
  return Buffer.from(
    `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`
  );
}

function parseDormantSessionJsonl(text: string): unknown[] {
  if (!text.endsWith("\n"))
    throw new ValidationError("Dormant session must be newline terminated");
  const lines = text.slice(0, -1).split("\n");
  if (lines.length !== 2 || lines.some((line) => line.length === 0))
    throw new ValidationError(
      "Dormant session must contain one header and one name entry"
    );
  let entries: unknown[];
  try {
    entries = lines.map((line) => JSON.parse(line));
  } catch {
    throw new ValidationError("Dormant session contains invalid JSONL");
  }
  const header = requireObject(entries[0], "session header");
  const info = requireObject(entries[1], "session name entry");
  if (
    header.type !== "session" ||
    header.version !== CURRENT_SESSION_VERSION ||
    info.type !== "session_info"
  )
    throw new ValidationError("Dormant session has an unsupported shape");
  return entries;
}

function normalizeManifest(manifest: SessionManifestV1): SessionManifestV1 {
  const sessions: Record<string, ParticipantSession> = Object.create(null);
  for (const participant of Object.keys(manifest.sessions).sort()) {
    const value = manifest.sessions[participant];
    sessions[participant] = {
      sessionId: sessionId(value.sessionId),
      sessionFile: value.sessionFile,
      name: value.name,
      parent: value.parent === null ? null : roleId(value.parent),
    };
  }
  return { formatVersion: 1, sessions };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireExactFields(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key)))
    throw new ValidationError(`${label} contains unknown or missing fields`);
}

function requireSafeAbsolutePath(
  value: unknown,
  label = "Session file path"
): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !isAbsolute(value) ||
    normalize(value) !== value
  )
    throw new ValidationError(`${label} must be an absolute normalized path`);
  return value;
}

/** JSON.parse discards duplicate keys, so scan all objects before decoding. */
function assertNoDuplicateJsonFields(text: string): void {
  let offset = 0;

  const fail = (message: string): never => {
    throw new ValidationError(message);
  };
  const whitespace = () => {
    while (offset < text.length && /\s/u.test(text[offset] as string)) offset++;
  };
  const string = (): string => {
    if (text[offset] !== '"') fail("sessions.json must contain valid JSON");
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        try {
          return JSON.parse(text.slice(start, offset)) as string;
        } catch {
          fail("sessions.json must contain valid JSON");
        }
      }
      if (character === "\\") {
        if (offset >= text.length)
          fail("sessions.json must contain valid JSON");
        offset++;
      } else if (character && character.charCodeAt(0) < 0x20) {
        fail("sessions.json must contain valid JSON");
      }
    }
    return fail("sessions.json must contain valid JSON");
  };
  const value = (depth: number): void => {
    if (depth > MAX_JSON_DEPTH)
      fail("sessions.json exceeds the supported nesting depth");
    whitespace();
    const character = text[offset];
    if (character === "{") {
      offset++;
      whitespace();
      const fields = new Set<string>();
      if (text[offset] === "}") {
        offset++;
        return;
      }
      while (offset < text.length) {
        whitespace();
        const field = string();
        if (fields.has(field)) fail("sessions.json contains a duplicate field");
        fields.add(field);
        whitespace();
        if (text[offset++] !== ":")
          fail("sessions.json must contain valid JSON");
        value(depth + 1);
        whitespace();
        const separator = text[offset++];
        if (separator === "}") return;
        if (separator !== ",") fail("sessions.json must contain valid JSON");
      }
      fail("sessions.json must contain valid JSON");
    }
    if (character === "[") {
      offset++;
      whitespace();
      if (text[offset] === "]") {
        offset++;
        return;
      }
      while (offset < text.length) {
        value(depth + 1);
        whitespace();
        const separator = text[offset++];
        if (separator === "]") return;
        if (separator !== ",") fail("sessions.json must contain valid JSON");
      }
      fail("sessions.json must contain valid JSON");
    }
    if (character === '"') {
      string();
      return;
    }
    const remainder = text.slice(offset);
    const token =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
        remainder
      );
    if (!token)
      throw new ValidationError("sessions.json must contain valid JSON");
    offset += token[0].length;
  };

  whitespace();
  value(0);
  whitespace();
  if (offset !== text.length) fail("sessions.json must contain valid JSON");
}
