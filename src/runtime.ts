import type { ExtensionFiles, ExtensionLogger } from "pi-extension-kit/files";
import { loadConfig } from "./config";
import type { FileSystem } from "./filesystem";
import { nodeFileSystem } from "./filesystem";
import { systemClock, ulidGenerator, ValidationError } from "./identifiers";
import { resolveIdentity } from "./identity";
import { MailboxStore } from "./mailbox-store";
import { loadMission } from "./mission";
import { ProjectionStore } from "./projections";
import type { ToolServices } from "./tool/services";

export interface RuntimeBindingInput {
  mission?: unknown;
  role?: unknown;
  session?: unknown;
  hostSession?: string;
}
export class MycelialRuntime {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: ToolServices | undefined;
  constructor(
    readonly files: ExtensionFiles,
    readonly logger: ExtensionLogger,
    readonly fs: FileSystem = nodeFileSystem
  ) {}
  async start(input: RuntimeBindingInput): Promise<ToolServices | undefined> {
    await this.stop();
    if (
      input.mission === undefined &&
      input.role === undefined &&
      input.session === undefined &&
      process.env.PI_MYCELIAL_MISSION === undefined &&
      process.env.PI_MYCELIAL_ROLE === undefined &&
      process.env.PI_MYCELIAL_SESSION === undefined
    )
      return undefined;
    const config = await loadConfig(this.files);
    const identity = resolveIdentity(
      {
        flagMission: input.mission,
        flagRole: input.role,
        flagSession: input.session,
        hostSession: input.hostSession,
      },
      config.missionRoot
    );
    if (!identity) return undefined;
    const mission = await loadMission(this.fs, identity.root);
    if (!mission.roles.includes(identity.role))
      throw new ValidationError(
        `Role ${identity.role} is not configured in agents.json`
      );
    const mailbox = new MailboxStore(
      this.fs,
      mission,
      systemClock,
      ulidGenerator,
      config
    );
    const projections = new ProjectionStore(this.fs, mission, systemClock, {
      retries: config.lockRetries,
      backoffMs: config.lockBackoffMs,
      minLeaseMs: config.minLeaseMs,
      maxLeaseMs: config.maxLeaseMs,
    });
    this.active = { mailbox, projections, identity, config };
    await mailbox.reconcile(identity.role);
    await projections.heartbeat(identity, config.presenceTtlMs);
    this.timer = setInterval(() => {
      void projections
        .heartbeat(identity, config.presenceTtlMs)
        .catch((error) =>
          this.logger.error("heartbeat failed", error, {
            mission: identity.mission,
            role: identity.role,
            session: identity.session,
          })
        );
    }, config.heartbeatIntervalMs);
    this.timer.unref?.();
    await this.logger.info("runtime bound", {
      mission: identity.mission,
      role: identity.role,
      session: identity.session,
    });
    return this.active;
  }
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const active = this.active;
    this.active = undefined;
    if (active) {
      try {
        await active.projections.heartbeat(
          active.identity,
          active.config.presenceTtlMs,
          true
        );
      } catch (error) {
        await this.logger.error("offline heartbeat failed", error);
      }
    }
  }
}
