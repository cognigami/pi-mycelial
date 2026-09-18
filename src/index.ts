import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExtensionFiles } from "pi-extension-kit/files";
import { runMycelialCommand } from "./command";
import { reportMycelialFooterSlot } from "./footer-slot";
import { MycelialRuntime } from "./runtime";
import { createAckTool } from "./tool/ack";
import { createMissionReadTool } from "./tool/mission-read";
import { createReadTool } from "./tool/read";
import { createReplyTool } from "./tool/reply";
import { createRosterTool } from "./tool/roster";
import { createSendTool } from "./tool/send";
import { createTaskClaimTool } from "./tool/task-claim";
import { createTaskReleaseTool } from "./tool/task-release";
import { createWakeTool } from "./tool/wake";

export default function mycelialExtension(pi: ExtensionAPI): void {
  const files = createExtensionFiles({ extensionName: "mycelial" });
  const logger = files.createLogger();
  const runtime = new MycelialRuntime(files, logger);
  let registered = false;

  pi.registerFlag("mycelial-mission", {
    description: "Mission identifier to bind",
    type: "string",
  });
  pi.registerFlag("mycelial-role", {
    description: "Trusted mission role to bind",
    type: "string",
  });
  pi.registerFlag("mycelial-session", {
    description: "Optional authoritative launcher session identifier",
    type: "string",
  });
  pi.registerCommand("mycelial", {
    description: "Initialize a Mycelial mission and generated Herdr launcher",
    handler: (args, ctx) => runMycelialCommand(args, ctx, files, logger),
  });

  pi.on("session_start", async (_event, ctx) => {
    reportMycelialFooterSlot(pi.events);
    try {
      const services = await runtime.start({
        mission: pi.getFlag("mycelial-mission"),
        role: pi.getFlag("mycelial-role"),
        session: pi.getFlag("mycelial-session"),
        hostSession: ctx.sessionManager.getSessionId(),
      });
      if (!services) return;
      reportMycelialFooterSlot(pi.events, services.identity);
      if (registered) return;
      pi.registerTool(createMissionReadTool(services));
      pi.registerTool(createSendTool(services));
      pi.registerTool(createReadTool(services));
      pi.registerTool(createAckTool(services));
      pi.registerTool(createReplyTool(services));
      pi.registerTool(createTaskClaimTool(services));
      pi.registerTool(createTaskReleaseTool(services));
      pi.registerTool(createRosterTool(services));
      pi.registerTool(
        createWakeTool(services, async (command, args, options) => {
          const result = await pi.exec(command, args, options);
          return {
            code: result.code ?? -1,
            killed: result.killed,
          };
        })
      );
      registered = true;
    } catch (error) {
      reportMycelialFooterSlot(pi.events);
      await logger.error("runtime binding failed", error);
      if (ctx.hasUI)
        ctx.ui.notify(
          `Mycelial inactive: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
    }
  });
  pi.on("session_shutdown", async () => {
    reportMycelialFooterSlot(pi.events);
    await runtime.stop();
  });
}
