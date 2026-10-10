import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, relative, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { replaceMutable } from "./atomic-files";
import { parseClaim } from "./claim-codec";
import { DEFAULT_CONFIG } from "./config";
import { type FileSystem, isMissing } from "./filesystem";
import {
  type MessageId,
  missionId,
  roleId,
  systemClock,
  taskId,
  ulidGenerator,
  ValidationError,
} from "./identifiers";
import { MailboxStore } from "./mailbox-store";
import { loadMission, type MissionSnapshot } from "./mission";
import { MissionPaths } from "./paths";
import type { ClaimRecord, TrustedIdentity } from "./protocol";
import { absolutePath, optionalNames, safePath } from "./rotation-paths";
import {
  discoverSessionFamily,
  readSessionHeader,
  type VerifiedSession,
} from "./session-discovery";
import {
  materializeSessionTopology,
  parseSessionManifest,
  prepareSessionTopology,
  type SessionManifestV1,
  serializeSessionManifest,
  validateMaterializedSessionTopology,
} from "./session-topology";

const OPERATION = ".session-rotation";
export const DOWNTIME_QUESTION =
  "Have you stopped all Pi agents and subagents in this mission, and will you keep them stopped until rotation finishes?";
export interface RotationInput {
  missionDirectory: string;
  saveHistory?: boolean;
  /** Test injection; CLI always uses the documented default Pi tree. */
  defaultSessionRoot?: string;
}
export interface RotationReport {
  missionId: string;
  roles: string[];
  roots: string[];
  family: VerifiedSession[];
  unread: Record<string, MessageId[]>;
  liveClaims: ClaimRecord[];
  warnings: string[];
  refusals: string[];
  discoveryProblems: string[];
  retention: boolean;
  mission?: MissionSnapshot;
  cwd?: string;
  controls: Record<string, string | null>;
  returned: Record<string, MessageId[]>;
}

export async function preflightRotation(
  fs: FileSystem,
  input: RotationInput,
  underOwnership = false
): Promise<RotationReport> {
  const root = absolutePath(input.missionDirectory);
  const id = missionId(basename(root));
  const report: RotationReport = {
    missionId: id,
    roles: [],
    roots: [],
    family: [],
    unread: {},
    liveClaims: [],
    warnings: [
      "The operation lock does not establish agent downtime. Custom child directories outside the reported roots require --save-history.",
    ],
    refusals: [],
    discoveryProblems: [],
    retention: !!input.saveHistory,
    controls: {},
    returned: {},
  };
  try {
    await safePath(fs, root, "directory");
    if (await pathExists(fs, join(root, `${OPERATION}-recovery`)))
      throw new ValidationError(
        "Recovery operation already exists; verify its process has exited before manual lock recovery"
      );
    if (!underOwnership && (await pathExists(fs, join(root, OPERATION))))
      throw new ValidationError(
        "Rotation operation already exists; explicit interrupted-operation recovery is required"
      );
    for (const name of [
      "mission.md",
      "agents.json",
      "repos.json",
      "sessions.json",
      "launch-herdr.sh",
    ]) {
      const path = join(root, name);
      report.controls[path] = await readOptionalControl(fs, path);
    }
    const mission = await loadMission(fs, root);
    await safePath(fs, join(root, "launch-herdr.sh"), "file");
    report.mission = mission;
    report.roles = mission.roles;
    if (!mission.sessions)
      throw new ValidationError(
        "Rotation requires an existing managed sessions.json"
      );
    if (!mission.sessions.sessions.coordinator)
      throw new ValidationError("Coordinator-free missions cannot be rotated");
    const managed: VerifiedSession[] = [];
    for (const role of mission.roles) {
      const session = mission.sessions.sessions[role];
      const file = await readSessionHeader(fs, session.sessionFile);
      const expectedParent =
        role === "coordinator"
          ? undefined
          : mission.sessions.sessions.coordinator.sessionFile;
      if (
        file.header.id !== session.sessionId ||
        file.header.parentSession !== expectedParent ||
        session.name !== `${id}: ${role}`
      )
        throw new ValidationError(
          `Old session does not match manifest: ${role}`
        );
      managed.push(file);
    }
    report.cwd = managed.find(
      (file) => file.path === mission.sessions?.sessions.coordinator.sessionFile
    )?.header.cwd;
    if (!report.cwd || managed.some((file) => file.header.cwd !== report.cwd))
      throw new ValidationError(
        "Old participants must share the coordinator cwd"
      );
    await safePath(fs, report.cwd, "directory");
    const defaultRoot = absolutePath(
      input.defaultSessionRoot ?? join(getAgentDir(), "sessions")
    );
    const roots = [defaultRoot];
    for (const file of managed) {
      const directory = dirname(file.path);
      const rel = relative(defaultRoot, directory);
      if (rel === ".." || rel.startsWith(`..${sep}`)) roots.push(directory);
    }
    const discovery = await discoverSessionFamily(fs, roots, managed);
    report.roots = discovery.roots;
    report.family = discovery.family;
    report.discoveryProblems = discovery.problems;
    for (const file of managed) {
      if (
        discovery.family.find((value) => value.path === file.path)
          ?.headerLine !== file.headerLine
      )
        throw new ValidationError(
          `Old managed header drift during preflight: ${file.path}`
        );
    }
    if (discovery.problems.length && !input.saveHistory)
      report.refusals.push(
        "Incomplete descendant discovery forbids deletion; use --save-history or resolve every discovery problem"
      );
    const mailbox = new MailboxStore(
      fs,
      mission,
      systemClock,
      ulidGenerator,
      DEFAULT_CONFIG
    );
    for (const role of mission.roles) {
      const identity = oldIdentity(report, role);
      const cursorPath = mission.paths.cursor(identity.role, identity.session);
      report.controls[cursorPath] = await readOptionalControl(fs, cursorPath);
      report.returned[role] =
        (await mailbox.readCursor(identity))?.returned ?? [];
      report.unread[role] = await mailbox.inspectUnread(identity);
      if (report.unread[role].length)
        report.warnings.push(
          `${role}: ${report.unread[role].length} unread canonical messages remain unread`
        );
    }
    for (const name of await optionalNames(fs, mission.paths.claims())) {
      if (!name.endsWith(".yaml")) continue;
      const task = taskId(name.slice(0, -5));
      const path = mission.paths.claim(task);
      await safePath(fs, path, "file");
      const claim = parseClaim(
        (await fs.readFile(path)).toString("utf8"),
        path
      );
      if (claim.task !== task)
        throw new ValidationError(
          `Claim identity does not match path: ${path}`
        );
      if (
        claim.status === "claimed" &&
        Date.parse(claim.expires) > Date.now() &&
        report.family.some((file) => file.header.id === claim.session)
      ) {
        report.liveClaims.push(claim);
        report.warnings.push(
          `${claim.task}: old-session owner ${claim.agent}/${claim.session} remains exclusive until ${claim.expires}; no claim transfer`
        );
      }
    }
    for (const [path, expected] of Object.entries(report.controls)) {
      if ((await readOptionalControl(fs, path)) !== expected)
        throw new ValidationError(
          `Control file drift during preflight: ${path}`
        );
    }
  } catch (error) {
    report.refusals.push(
      error instanceof Error ? error.message : String(error)
    );
  }
  return report;
}
function oldIdentity(report: RotationReport, role: string): TrustedIdentity {
  const session = report.mission?.sessions?.sessions[role];
  if (!session)
    throw new ValidationError("Missing preflight participant session");
  return {
    mission: missionId(report.missionId),
    role: roleId(role),
    session: session.sessionId,
  };
}
async function readOptionalControl(
  fs: FileSystem,
  path: string
): Promise<string | null> {
  if (!(await safePath(fs, path, "file", true))) return null;
  return (await fs.readFile(path)).toString("base64");
}
async function pathExists(fs: FileSystem, path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export interface RotationOperator {
  /** CLI supplies an interactive TTY implementation; no unattended bypass. */
  confirm(question: string): Promise<boolean>;
  report(report: RotationReport): void;
  phase(phase: string): void;
  signal?: AbortSignal;
}
export interface RotationResult {
  state: "cancelled" | "rolled-back" | "committed" | "recovery-required";
  remaining: string[];
  error?: string;
}
interface OwnedArtifact {
  path: string;
  dev: number;
  ino: number;
  sha256: string;
}
interface RecoveryRecord {
  formatVersion: 1;
  token: string;
  root: string;
  cwd: string;
  oldManifest: string;
  intendedManifest: string;
  controls: Record<string, string | null>;
  oldFamily: VerifiedSession[];
  saveHistory: boolean;
  artifacts: OwnedArtifact[];
  directories: Array<{ path: string; dev: number; ino: number }>;
  /** Temp paths whose exclusive creation has not yet acquired durable evidence. */
  uncertain: string[];
}
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const recordPath = (root: string) => join(root, OPERATION, "recovery.json");

async function persist(fs: FileSystem, record: RecoveryRecord): Promise<void> {
  await replaceMutable(
    fs,
    recordPath(record.root),
    Buffer.from(`${JSON.stringify(record)}\n`)
  );
}
async function assertOwner(
  fs: FileSystem,
  record: RecoveryRecord
): Promise<void> {
  await safePath(fs, join(record.root, OPERATION), "directory");
  await safePath(fs, join(record.root, OPERATION, "owner"), "file");
  if (
    (await fs.readFile(join(record.root, OPERATION, "owner"))).toString(
      "utf8"
    ) !== record.token
  )
    throw new ValidationError("Rotation ownership lost");
}

/** Persist stage inode BEFORE final linking; a publish-then-throw is still owned.
 * Existing-identical final files never share that inode and never grant ownership.
 * Every stage path is recorded before open; a crash before evidence is conservative
 * residue, not permission to delete a potential preexisting collision.
 */
function ownedFileSystem(fs: FileSystem, record: RecoveryRecord): FileSystem {
  return {
    ...fs,
    mkdir: async (path, options) => {
      if (options?.recursive) {
        // Stage parents must already have been safely created by the ordinary
        // protocol-directory helper, never recursively discover ownership.
        await safePath(fs, path, "directory");
        return;
      }
      await assertOwner(fs, record);
      record.uncertain.push(path);
      await persist(fs, record);
      await fs.mkdir(path, options);
      const stat = await fs.lstat(path);
      record.directories.push({ path, dev: stat.dev, ino: stat.ino });
      record.uncertain = record.uncertain.filter((value) => value !== path);
      await persist(fs, record);
    },
    open: async (path, flags, mode) => {
      if (flags !== "wx") return fs.open(path, flags, mode);
      await assertOwner(fs, record);
      record.uncertain.push(path);
      await persist(fs, record);
      const handle = await fs.open(path, flags, mode);
      const stat = await fs.lstat(path);
      // No content yet; evidence is completed after the stage has synced.
      return {
        writeFile: handle.writeFile.bind(handle),
        close: handle.close.bind(handle),
        sync: async () => {
          await handle.sync();
          record.artifacts.push({
            path,
            dev: stat.dev,
            ino: stat.ino,
            sha256: hash(await fs.readFile(path)),
          });
          record.uncertain = record.uncertain.filter((value) => value !== path);
          await persist(fs, record);
        },
      };
    },
    link: async (from, to) => {
      await assertOwner(fs, record);
      const stat = await fs.lstat(from);
      const evidence = record.artifacts.find(
        (item) =>
          item.path === from && item.dev === stat.dev && item.ino === stat.ino
      );
      if (!evidence) throw new ValidationError("Unowned publication stage");
      await safePath(fs, dirname(to), "directory");
      record.artifacts.push({ ...evidence, path: to });
      await persist(fs, record);
      await fs.link(from, to);
    },
  };
}

export async function rotateMission(
  fs: FileSystem,
  input: RotationInput,
  operator: RotationOperator
): Promise<RotationResult> {
  if (!(await operator.confirm(DOWNTIME_QUESTION)))
    return { state: "cancelled", remaining: [] };
  const root = absolutePath(input.missionDirectory);
  await safePath(fs, root, "directory");
  if (await pathExists(fs, join(root, `${OPERATION}-recovery`)))
    throw new ValidationError("An explicit recovery operation already exists");
  // Never auto-break a leftover operation, even if its recorded PID is dead.
  await fs.mkdir(join(root, OPERATION), { mode: 0o700 });
  const token = randomUUID();
  let record: RecoveryRecord | undefined;
  let earlyResult: RotationResult | undefined;
  let validated = false;
  try {
    const owner = await fs.open(join(root, OPERATION, "owner"), "wx", 0o600);
    try {
      await owner.writeFile(Buffer.from(token));
      await owner.sync();
    } finally {
      await owner.close();
    }
    await fs.syncDirectory(join(root, OPERATION));
    operator.phase("preflight");
    const report = await preflightRotation(fs, input, true);
    operator.report(report);
    if (report.refusals.length)
      throw new ValidationError(report.refusals.join("; "));
    if (
      !input.saveHistory &&
      !(await operator.confirm(
        `Permanently delete exactly the ${report.family.length} old session files shown above after switching the manifest?`
      ))
    ) {
      earlyResult = { state: "cancelled", remaining: [] };
      return earlyResult;
    }
    checkCancellation(operator);
    const mission = report.mission;
    const cwd = report.cwd;
    if (!mission?.sessions || !cwd)
      throw new ValidationError("Incomplete preflight");
    const oldManifest = report.controls[mission.paths.sessionsFile()];
    if (!oldManifest)
      throw new ValidationError("Missing old manifest snapshot");
    const prepared = prepareSessionTopology({
      cwd,
      sessionDir: dirname(mission.sessions.sessions.coordinator.sessionFile),
      mission: report.missionId,
      participants: mission.agents,
    });
    record = {
      formatVersion: 1,
      token,
      root,
      cwd,
      oldManifest,
      intendedManifest: Buffer.from(
        serializeSessionManifest(prepared.manifest, mission.agents)
      ).toString("base64"),
      controls: report.controls,
      oldFamily: report.family,
      saveHistory: !!input.saveHistory,
      artifacts: [],
      directories: [],
      uncertain: [],
    };
    await persist(fs, record);
    const ownedFs = ownedFileSystem(fs, record);
    operator.phase("prepare sessions and cursors");
    await materializeSessionTopology(ownedFs, prepared);
    const mailbox = new MailboxStore(
      ownedFs,
      mission,
      systemClock,
      ulidGenerator,
      DEFAULT_CONFIG
    );
    for (const role of mission.roles)
      await mailbox.initializeCursor(
        {
          ...oldIdentity(report, role),
          session: prepared.manifest.sessions[role].sessionId,
        },
        report.returned[role]
      );
    await validateMaterializedSessionTopology(
      fs,
      prepared.manifest,
      mission.agents,
      record.cwd
    );
    for (const session of Object.values(prepared.manifest.sessions)) {
      const artifact = record.artifacts.find(
        (value) => value.path === session.sessionFile
      );
      if (!artifact || !(await artifactOwned(fs, artifact)))
        throw new ValidationError(
          `Replacement destination was not exclusively created: ${session.sessionFile}`
        );
    }
    await assertOwner(fs, record);
    for (const [path, expected] of Object.entries(record.controls))
      if ((await readOptionalControl(fs, path)) !== expected)
        throw new ValidationError(`Control file drift: ${path}`);
    for (const file of report.family)
      if (
        (await readSessionHeader(fs, file.path)).headerLine !== file.headerLine
      )
        throw new ValidationError(`Old header drift: ${file.path}`);
    checkCancellation(operator);
    operator.phase("publish manifest");
    const publicationRecord = record;
    await replaceMutable(
      {
        ...ownedFs,
        rename: async (from, to) => {
          await assertOwner(fs, publicationRecord);
          // Staging awaits may observe SIGINT. This is the last check before
          // publication; after rename, classify the active manifest instead.
          checkCancellation(operator);
          await fs.rename(from, to);
        },
      },
      mission.paths.sessionsFile(),
      Buffer.from(record.intendedManifest, "base64")
    );
    await validateActive(fs, record, true);
    validated = true;
    operator.phase(
      record.saveHistory ? "retain history" : "delete verified old tree LAST"
    );
    return await finishCommitted(fs, record);
  } catch (error) {
    if (!record) {
      earlyResult = {
        state: "rolled-back",
        remaining: [],
        error: String(error),
      };
      return earlyResult;
    }
    const active = await classifyManifest(fs, record);
    if (active === "old") {
      const remaining = await rollbackOwned(fs, record);
      if (!remaining.length) {
        try {
          await removeOperation(fs, record);
        } catch {
          remaining.push(join(root, OPERATION));
        }
      }
      return {
        state: remaining.length ? "recovery-required" : "rolled-back",
        remaining,
        error: String(error),
      };
    }
    // New may already be active despite a thrown rename/sync/read-back boundary.
    return {
      state: "recovery-required",
      remaining: record.oldFamily.map((file) => file.path),
      error: `${String(error)}; manifest=${active}, validated=${validated}; no active-tree rollback`,
    };
  } finally {
    if (!record) {
      // Exact directory exclusively created above; no recursive removal.
      try {
        if (await pathExists(fs, join(root, OPERATION, "owner")))
          await fs.unlink(join(root, OPERATION, "owner"));
        await fs.rmdir(join(root, OPERATION));
      } catch (error) {
        if (earlyResult) {
          earlyResult.state = "recovery-required";
          earlyResult.remaining = [join(root, OPERATION)];
          earlyResult.error = `Old tree unchanged; operation-lock cleanup residue requires manual recovery: ${String(error)}`;
        }
      }
    }
  }
}
function checkCancellation(operator: RotationOperator): void {
  if (operator.signal?.aborted)
    throw operator.signal.reason ?? new Error("Rotation cancelled");
}
async function classifyManifest(
  fs: FileSystem,
  record: RecoveryRecord
): Promise<"old" | "new" | "unknown"> {
  try {
    const current = await readOptionalControl(
      fs,
      join(record.root, "sessions.json")
    );
    if (current === record.oldManifest) return "old";
    if (current === record.intendedManifest) return "new";
  } catch {
    /* ambiguous: preserve both trees */
  }
  return "unknown";
}
async function validateActive(
  fs: FileSystem,
  record: RecoveryRecord,
  dormant: boolean
): Promise<SessionManifestV1> {
  if ((await classifyManifest(fs, record)) !== "new")
    throw new ValidationError("Intended replacement manifest is not active");
  const mission = await loadMission(fs, record.root);
  const intended = parseSessionManifest(
    Buffer.from(record.intendedManifest, "base64").toString("utf8"),
    mission.agents
  );
  // Control configuration must not drift even in recovery. Old cursors may stay
  // untouched; new cursors/transcripts can evolve after an operator relaunch.
  for (const path of [
    mission.paths.missionFile(),
    mission.paths.agentsFile(),
    mission.paths.reposFile(),
    join(record.root, "launch-herdr.sh"),
  ])
    if ((await readOptionalControl(fs, path)) !== record.controls[path])
      throw new ValidationError(`Control file drift: ${path}`);
  if (dormant)
    await validateMaterializedSessionTopology(
      fs,
      intended,
      mission.agents,
      record.cwd
    );
  const mailbox = new MailboxStore(
    fs,
    mission,
    systemClock,
    ulidGenerator,
    DEFAULT_CONFIG
  );
  for (const role of mission.roles) {
    const session = intended.sessions[role];
    const file = await readSessionHeader(fs, session.sessionFile);
    if (
      file.header.id !== session.sessionId ||
      file.header.cwd !== record.cwd ||
      file.header.parentSession !==
        (role === "coordinator"
          ? undefined
          : intended.sessions.coordinator.sessionFile)
    )
      throw new ValidationError(`Active session mismatch: ${role}`);
    if (
      !(await mailbox.readCursor({
        mission: missionId(basename(record.root)),
        role,
        session: session.sessionId,
      }))
    )
      throw new ValidationError(`Missing replacement cursor: ${role}`);
  }
  return intended;
}
async function artifactOwned(
  fs: FileSystem,
  artifact: OwnedArtifact
): Promise<boolean> {
  if (!(await safePath(fs, artifact.path, "file", true))) return false;
  const stat = await fs.lstat(artifact.path);
  return (
    stat.dev === artifact.dev &&
    stat.ino === artifact.ino &&
    hash(await fs.readFile(artifact.path)) === artifact.sha256
  );
}
async function rollbackOwned(
  fs: FileSystem,
  record: RecoveryRecord
): Promise<string[]> {
  await assertOwner(fs, record);
  const remaining: string[] = [];
  for (const artifact of [...record.artifacts].reverse()) {
    try {
      if (!(await pathExists(fs, artifact.path))) continue;
      if (!(await artifactOwned(fs, artifact))) {
        // A final collision not matching the stage inode was never ours.
        // A matching inode with changed bytes is owned but unsafe to remove.
        const stat = await fs.lstat(artifact.path);
        if (
          (stat.dev === artifact.dev && stat.ino === artifact.ino) ||
          basename(artifact.path).startsWith(".")
        )
          remaining.push(artifact.path);
        continue;
      }
      await fs.unlink(artifact.path);
    } catch {
      remaining.push(artifact.path);
    }
  }
  for (const directory of [...record.directories].reverse()) {
    try {
      if (!(await pathExists(fs, directory.path))) continue;
      await safePath(fs, directory.path, "directory");
      const stat = await fs.lstat(directory.path);
      if (stat.dev !== directory.dev || stat.ino !== directory.ino) {
        remaining.push(directory.path);
        continue;
      }
      await fs.rmdir(directory.path);
    } catch {
      remaining.push(directory.path);
    }
  }
  for (const path of record.uncertain)
    if (await pathExists(fs, path)) remaining.push(path);
  return [...new Set(remaining)];
}
/** Only synced invocation-owned stages, never final sessions/cursors/manifest. */
async function cleanupOwnedStages(
  fs: FileSystem,
  record: RecoveryRecord,
  protectedPaths: ReadonlySet<string>
): Promise<string[]> {
  const remaining = new Set<string>();
  for (const artifact of record.artifacts) {
    if (
      !basename(artifact.path).startsWith(".") ||
      !artifact.path.endsWith(".tmp")
    )
      continue;
    try {
      if (protectedPaths.has(artifact.path)) {
        remaining.add(artifact.path);
        continue;
      }
      if (!(await pathExists(fs, artifact.path))) {
        await fs.syncDirectory(dirname(artifact.path));
        continue;
      }
      if (!(await artifactOwned(fs, artifact))) {
        remaining.add(artifact.path);
        continue;
      }
      await assertOwner(fs, record);
      await fs.unlink(artifact.path);
      await fs.syncDirectory(dirname(artifact.path));
    } catch {
      remaining.add(
        (await pathExists(fs, artifact.path))
          ? artifact.path
          : join(record.root, OPERATION)
      );
    }
  }
  return [...remaining];
}

async function finishCommitted(
  fs: FileSystem,
  record: RecoveryRecord
): Promise<RotationResult> {
  await assertOwner(fs, record);
  const active = await validateActive(fs, record, false);
  const excluded = new Set(
    Object.values(active.sessions).map((session) => session.sessionFile)
  );
  // Best-effort publication cleanup may have left a synced hard-link stage.
  // Keep its ownership evidence and active finals; old-tree deletion stays LAST.
  const paths = new MissionPaths(record.root);
  const protectedPaths = new Set([
    ...excluded,
    join(record.root, "sessions.json"),
    ...Object.entries(active.sessions).map(([role, session]) =>
      paths.cursor(roleId(role), session.sessionId)
    ),
  ]);
  const stages = await cleanupOwnedStages(fs, record, protectedPaths);
  if (stages.length)
    return {
      state: "recovery-required",
      remaining: stages,
      error:
        "Replacement committed; owned preparation stages remain. Old history retained until explicit recovery.",
    };
  const remaining: string[] = [];
  let cleanupInterrupted = false;
  if (!record.saveHistory) {
    for (let index = 0; index < record.oldFamily.length; index++) {
      const file = record.oldFamily[index] as VerifiedSession;
      try {
        if (excluded.has(file.path))
          throw new ValidationError("Cleanup includes an active replacement");
        if (!(await pathExists(fs, file.path))) {
          // A prior unlink may have succeeded before directory sync failed.
          if (await safePath(fs, dirname(file.path), "directory", true))
            await fs.syncDirectory(dirname(file.path));
          continue;
        }
        if (
          (await readSessionHeader(fs, file.path)).headerLine !==
          file.headerLine
        )
          throw new ValidationError("Old session header changed");
        await assertOwner(fs, record);
        await fs.unlink(file.path);
        await fs.syncDirectory(dirname(file.path));
      } catch {
        // Stop: retaining parents is safer when a child cannot be deleted.
        cleanupInterrupted = true;
        for (const value of record.oldFamily.slice(index)) {
          try {
            if (await pathExists(fs, value.path)) remaining.push(value.path);
          } catch {
            remaining.push(value.path);
          }
        }
        break;
      }
    }
  }
  if (cleanupInterrupted)
    return {
      state: "recovery-required",
      remaining: remaining.length ? remaining : [join(record.root, OPERATION)],
      error:
        "Replacement committed; old-tree cleanup or its durability confirmation incomplete. Recover, do not rotate again.",
    };
  // Publication helpers remove their own temps. Any uncertain residue prevents
  // dropping its only recovery information, even on an otherwise complete run.
  for (const path of record.uncertain)
    if (await pathExists(fs, path)) remaining.push(path);
  if (remaining.length)
    return {
      state: "recovery-required",
      remaining,
      error:
        "Replacement committed; uncertain preparation residue requires manual review",
    };
  try {
    await removeOperation(fs, record);
  } catch (error) {
    return {
      state: "recovery-required",
      remaining: [join(record.root, OPERATION)],
      error: `Tree committed and history policy completed; operation metadata cleanup requires manual review: ${String(error)}`,
    };
  }
  return { state: "committed", remaining: [] };
}
async function removeOperation(
  fs: FileSystem,
  record: RecoveryRecord
): Promise<void> {
  await assertOwner(fs, record);
  try {
    await fs.unlink(recordPath(record.root));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await fs.unlink(join(record.root, OPERATION, "owner"));
  await fs.rmdir(join(record.root, OPERATION));
  await fs.syncDirectory(record.root);
}

/** Explicit operator recovery only, with no new topology creation. */
export async function recoverRotation(
  fs: FileSystem,
  input: RotationInput,
  operator: RotationOperator
): Promise<RotationResult> {
  if (
    !(await operator.confirm(
      "Have you verified the previous rotation process has exited? Never recover while another rotation is running."
    ))
  )
    return { state: "cancelled", remaining: [] };
  if (!(await operator.confirm(DOWNTIME_QUESTION)))
    return { state: "cancelled", remaining: [] };
  const root = absolutePath(input.missionDirectory);
  await safePath(fs, root, "directory");
  const exclusion = join(root, `${OPERATION}-recovery`);
  await fs.mkdir(exclusion, { mode: 0o700 });
  try {
    return await recoverHeldRotation(fs, input, operator);
  } finally {
    await fs.rmdir(exclusion);
  }
}

async function recoverHeldRotation(
  fs: FileSystem,
  input: RotationInput,
  operator: RotationOperator
): Promise<RotationResult> {
  const root = absolutePath(input.missionDirectory);
  await safePath(fs, recordPath(root), "file");
  const record = JSON.parse(
    (await fs.readFile(recordPath(root))).toString("utf8")
  ) as RecoveryRecord;
  // Fail closed on changed/replaced recovery data. This local control file is
  // operator-owned, never model input; validate all destructive path invariants.
  if (
    record.formatVersion !== 1 ||
    record.root !== root ||
    !Array.isArray(record.artifacts) ||
    !Array.isArray(record.directories) ||
    !Array.isArray(record.oldFamily) ||
    !Array.isArray(record.uncertain) ||
    typeof record.saveHistory !== "boolean"
  )
    throw new ValidationError("Invalid recovery record");
  absolutePath(record.cwd);
  await assertOwner(fs, record);
  const mission = await loadMission(fs, root);
  const old = parseSessionManifest(
    Buffer.from(record.oldManifest, "base64").toString("utf8"),
    mission.agents
  );
  const intended = parseSessionManifest(
    Buffer.from(record.intendedManifest, "base64").toString("utf8"),
    mission.agents
  );
  const oldPaths = new Set(
    Object.values(old.sessions).map((value) => value.sessionFile)
  );
  const oldIds = new Set(
    Object.values(old.sessions).map((value) => value.sessionId)
  );
  for (const session of Object.values(intended.sessions)) {
    if (oldPaths.has(session.sessionFile) || oldIds.has(session.sessionId))
      throw new ValidationError(
        "Recovery replacement overlaps the retiring tree"
      );
  }
  const headers = new Map(
    record.oldFamily.map((file) => [absolutePath(file.path), file])
  );
  if (headers.size !== record.oldFamily.length)
    throw new ValidationError("Duplicate recovery family");
  for (const [role, session] of Object.entries(old.sessions)) {
    const file = headers.get(session.sessionFile);
    if (
      !file ||
      file.header.id !== session.sessionId ||
      file.header.cwd !== record.cwd ||
      file.header.parentSession !==
        (role === "coordinator"
          ? undefined
          : old.sessions.coordinator.sessionFile)
    )
      throw new ValidationError(
        "Recovery old managed identity does not match manifest"
      );
  }
  for (const file of record.oldFamily) {
    if (
      JSON.stringify(JSON.parse(file.headerLine)) !==
      JSON.stringify(file.header)
    )
      throw new ValidationError("Recovery header identity mismatch");
    const chain = new Set<string>();
    let path: string | undefined = file.path;
    while (path && !oldPaths.has(path)) {
      if (chain.has(path)) throw new ValidationError("Cyclic recovery family");
      chain.add(path);
      path = headers.get(path)?.header.parentSession;
    }
    if (!path)
      throw new ValidationError("Recovery family is unrelated to old manifest");
    if (
      Object.values(intended.sessions).some(
        (value) => value.sessionFile === file.path
      )
    )
      throw new ValidationError("Recovery includes active replacement");
  }
  const depth = (file: VerifiedSession): number => {
    let count = 0;
    for (
      let parent = file.header.parentSession;
      parent && headers.has(parent);
      parent = headers.get(parent)?.header.parentSession
    )
      count++;
    return count;
  };
  record.oldFamily.sort(
    (left, right) =>
      depth(right) - depth(left) || left.path.localeCompare(right.path)
  );
  operator.phase(
    `Recovery scope: ${record.oldFamily.map((file) => file.path).join(", ")}`
  );
  const active = await classifyManifest(fs, record);
  checkCancellation(operator);
  if (active === "old") {
    const allowed = new Set([
      ...Object.values(intended.sessions).map((value) => value.sessionFile),
      ...mission.roles.map((role) =>
        mission.paths.cursor(role, intended.sessions[role].sessionId)
      ),
    ]);
    const cursorDirectories = new Set([
      join(root, "cursors"),
      ...mission.roles.map((role) =>
        dirname(mission.paths.cursor(role, intended.sessions[role].sessionId))
      ),
    ]);
    for (const directory of record.directories)
      if (!cursorDirectories.has(absolutePath(directory.path)))
        throw new ValidationError("Unexpected owned directory path");
    for (const artifact of record.artifacts) {
      absolutePath(artifact.path);
      if (
        !allowed.has(artifact.path) &&
        ![...allowed, join(root, "sessions.json")].some(
          (path) =>
            dirname(path) === dirname(artifact.path) &&
            basename(artifact.path).startsWith(`.${basename(path)}.`) &&
            artifact.path.endsWith(".tmp")
        )
      )
        throw new ValidationError("Unexpected owned artifact path");
    }
    if (
      !(await operator.confirm(
        "Old manifest is active. Remove only inode/content-verified new artifacts from this interrupted invocation?"
      ))
    )
      return { state: "cancelled", remaining: [] };
    const remaining = await rollbackOwned(fs, record);
    if (!remaining.length) await removeOperation(fs, record);
    return {
      state: remaining.length ? "recovery-required" : "rolled-back",
      remaining,
    };
  }
  if (active !== "new")
    throw new ValidationError(
      "Ambiguous active manifest; preserve both trees for manual intervention"
    );
  await validateActive(fs, record, false);
  if (
    !record.saveHistory &&
    !(await operator.confirm(
      "Permanently delete the remaining verified old session files shown above?"
    ))
  )
    return { state: "cancelled", remaining: [] };
  return finishCommitted(fs, record);
}
