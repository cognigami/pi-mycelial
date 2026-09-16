import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionFiles } from "pi-extension-kit/files";
import { ValidationError } from "./identifiers";

export interface MycelialConfig {
  missionRoot: string;
  heartbeatIntervalMs: number;
  presenceTtlMs: number;
  defaultLeaseMs: number;
  minLeaseMs: number;
  maxLeaseMs: number;
  readLimit: number;
  readMaxBytes: number;
  messageMaxBytes: number;
  lockRetries: number;
  lockBackoffMs: number;
}
export const DEFAULT_CONFIG: MycelialConfig = {
  missionRoot: join(homedir(), "mycelial", "missions"),
  heartbeatIntervalMs: 30_000,
  presenceTtlMs: 90_000,
  defaultLeaseMs: 600_000,
  minLeaseMs: 30_000,
  maxLeaseMs: 3_600_000,
  readLimit: 20,
  readMaxBytes: 40_000,
  messageMaxBytes: 32_000,
  lockRetries: 4,
  lockBackoffMs: 25,
};
export async function loadConfig(
  files: ExtensionFiles
): Promise<MycelialConfig> {
  const loaded = await files.loadConfig<MycelialConfig>({
    defaults: DEFAULT_CONFIG,
    normalize: normalizeConfig,
  });
  return loaded.config;
}
function normalizeConfig(raw: unknown): MycelialConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ValidationError("Mycelial config must be an object");
  const o = raw as Record<string, unknown>;
  const n = (key: keyof MycelialConfig) => {
    const value = o[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
      throw new ValidationError(`Config ${key} must be a positive integer`);
    return value;
  };
  const missionRoot = o.missionRoot;
  if (typeof missionRoot !== "string" || missionRoot.length === 0)
    throw new ValidationError("Config missionRoot must be a path");
  const config = {
    missionRoot: resolve(missionRoot.replace(/^~(?=\/)/, homedir())),
    heartbeatIntervalMs: n("heartbeatIntervalMs"),
    presenceTtlMs: n("presenceTtlMs"),
    defaultLeaseMs: n("defaultLeaseMs"),
    minLeaseMs: n("minLeaseMs"),
    maxLeaseMs: n("maxLeaseMs"),
    readLimit: n("readLimit"),
    readMaxBytes: n("readMaxBytes"),
    messageMaxBytes: n("messageMaxBytes"),
    lockRetries: n("lockRetries"),
    lockBackoffMs: n("lockBackoffMs"),
  };
  if (
    config.minLeaseMs > config.defaultLeaseMs ||
    config.defaultLeaseMs > config.maxLeaseMs ||
    config.heartbeatIntervalMs >= config.presenceTtlMs
  )
    throw new ValidationError("Invalid lease or heartbeat config ranges");
  return config;
}
