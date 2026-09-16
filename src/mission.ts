import { isAbsolute, relative, sep } from "node:path";
import type { FileSystem } from "./filesystem";
import { isMissing } from "./filesystem";
import {
  type PresetName,
  presetName,
  type RepoAlias,
  type RoleId,
  repoAlias,
  roleId,
  ValidationError,
} from "./identifiers";
import { parseJson } from "./json-codec";
import { MissionPaths } from "./paths";

export interface AgentConfig {
  role: RoleId;
  preset?: PresetName;
}

export interface MissionSnapshot {
  paths: MissionPaths;
  agents: AgentConfig[];
  roles: RoleId[];
  repos: RepoAlias[];
}

export async function loadMission(
  fs: FileSystem,
  root: string
): Promise<MissionSnapshot> {
  const paths = new MissionPaths(root);
  await requireRegular(fs, paths.missionFile());
  await requireRegular(fs, paths.agentsFile());
  await assertInsideRealRoot(fs, paths);
  const agents = parseJson(
    (await fs.readFile(paths.agentsFile())).toString("utf8"),
    paths.agentsFile(),
    parseAgents
  );
  const roles = agents.map((agent) => agent.role);
  let repos: RepoAlias[] = [];
  try {
    await requireRegular(fs, paths.reposFile());
    repos = parseJson(
      (await fs.readFile(paths.reposFile())).toString("utf8"),
      paths.reposFile(),
      (value) => parseNames(value, "repos").map(repoAlias).sort()
    );
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return { paths, agents, roles, repos };
}

export function resolveRecipients(
  snapshot: MissionSnapshot,
  sender: RoleId,
  to: string
): { to: RoleId | "all"; recipients: RoleId[] } {
  if (!snapshot.roles.includes(sender))
    throw new ValidationError(`Unknown sender role: ${sender}`);
  if (to === "all")
    return {
      to,
      recipients: snapshot.roles.filter((role) => role !== sender).sort(),
    };
  const direct = roleId(to);
  if (!snapshot.roles.includes(direct))
    throw new ValidationError(`Unknown recipient role: ${to}`);
  return { to: direct, recipients: [direct] };
}
export function validateRepo(
  snapshot: MissionSnapshot,
  value: string | undefined
): RepoAlias | undefined {
  if (value === undefined) return undefined;
  const repo = repoAlias(value);
  if (!snapshot.repos.includes(repo))
    throw new ValidationError(`Unknown repository alias: ${value}`);
  return repo;
}

export async function readMissionDocument(
  fs: FileSystem,
  snapshot: MissionSnapshot,
  maxBytes: number
): Promise<{ text: string; truncated: boolean; totalBytes: number }> {
  const path = snapshot.paths.missionFile();
  await requireRegular(fs, path);
  await assertInsideRealRoot(fs, snapshot.paths);
  const content = await fs.readFile(path);
  const truncated = content.byteLength > maxBytes;
  const text = (truncated ? content.subarray(0, maxBytes) : content).toString(
    "utf8"
  );
  return { text, truncated, totalBytes: content.byteLength };
}

function parseAgents(value: unknown): AgentConfig[] {
  const parsed = parseAgentEntries(value)
    .map((agent) => ({
      role: roleId(agent.role),
      ...(agent.preset === undefined
        ? {}
        : { preset: presetName(agent.preset) }),
    }))
    .sort((left, right) => left.role.localeCompare(right.role));
  const roles = parsed.map((agent) => agent.role);
  if (parsed.length === 0 || new Set(roles).size !== roles.length)
    throw new ValidationError("agents.json must define unique roles");
  return parsed;
}

function parseAgentEntries(
  value: unknown
): Array<{ role: string; preset?: string }> {
  if (Array.isArray(value))
    return value.map((entry) => {
      if (typeof entry === "string") return { role: entry };
      if (!entry || typeof entry !== "object")
        throw new ValidationError("Invalid agents entry");
      const record = entry as Record<string, unknown>;
      const role = record.role ?? record.name;
      if (typeof role !== "string")
        throw new ValidationError("Invalid agents entry");
      return { role, ...parsePreset(record) };
    });
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, "agents"))
      return parseAgentEntries(record.agents);
    return Object.entries(record).map(([role, metadata]) => {
      if (metadata === null) return { role };
      if (!metadata || typeof metadata !== "object")
        throw new ValidationError(`Invalid agents metadata for ${role}`);
      return { role, ...parsePreset(metadata as Record<string, unknown>) };
    });
  }
  throw new ValidationError("agents.json must be an array or object");
}

function parsePreset(record: Record<string, unknown>): { preset?: string } {
  if (record.preset === undefined) return {};
  if (typeof record.preset !== "string")
    throw new ValidationError("Agent preset must be a string");
  return { preset: record.preset };
}

function parseNames(value: unknown, label: string): string[] {
  if (Array.isArray(value))
    return value.map((entry) =>
      typeof entry === "string" ? entry : objectName(entry, label)
    );
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested = record[label];
    if (Array.isArray(nested)) return parseNames(nested, label);
    return Object.keys(record);
  }
  throw new ValidationError(`${label}.json must be an array or object`);
}
function objectName(value: unknown, label: string): string {
  if (!value || typeof value !== "object")
    throw new ValidationError(`Invalid ${label} entry`);
  const record = value as Record<string, unknown>;
  const name = record.role ?? record.name ?? record.alias;
  if (typeof name !== "string")
    throw new ValidationError(`Invalid ${label} entry`);
  return name;
}
async function requireRegular(fs: FileSystem, path: string) {
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new ValidationError(
      `Required control file is not a regular file: ${path}`
    );
}
async function assertInsideRealRoot(fs: FileSystem, paths: MissionPaths) {
  const realRoot = await fs.realpath(paths.root);
  const missionReal = await fs.realpath(paths.missionFile());
  const rel = relative(realRoot, missionReal);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new ValidationError("mission control file escapes mission root");
}
