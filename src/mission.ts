import { isAbsolute, relative, sep } from "node:path";
import type { FileSystem } from "./filesystem";
import { isMissing } from "./filesystem";
import {
  type RepoAlias,
  type RoleId,
  repoAlias,
  roleId,
  ValidationError,
} from "./identifiers";
import { parseJson } from "./json-codec";
import { MissionPaths } from "./paths";

export interface MissionSnapshot {
  paths: MissionPaths;
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
  const roles = parseJson(
    (await fs.readFile(paths.agentsFile())).toString("utf8"),
    paths.agentsFile(),
    (agents) => {
      const parsed = parseNames(agents, "agents").map(roleId).sort();
      if (parsed.length === 0 || new Set(parsed).size !== parsed.length)
        throw new ValidationError("agents.json must define unique roles");
      return parsed;
    }
  );
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
  return { paths, roles, repos };
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
