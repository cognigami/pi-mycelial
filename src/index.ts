import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExtensionFiles } from "pi-extension-kit/files";
import { MycelialRuntime } from "./runtime";
import { createAckTool } from "./tool/ack";
import { createReadTool } from "./tool/read";
import { createReplyTool } from "./tool/reply";
import { createRosterTool } from "./tool/roster";
import { createSendTool } from "./tool/send";
import { createTaskClaimTool } from "./tool/task-claim";
import { createTaskReleaseTool } from "./tool/task-release";

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

  pi.on("session_start", async (_event, ctx) => {
    try {
      const services = await runtime.start({
        mission: pi.getFlag("mycelial-mission"),
        role: pi.getFlag("mycelial-role"),
        session: pi.getFlag("mycelial-session"),
        hostSession: ctx.sessionManager.getSessionId(),
      });
      if (!services || registered) return;
      pi.registerTool(createSendTool(services));
      pi.registerTool(createReadTool(services));
      pi.registerTool(createAckTool(services));
      pi.registerTool(createReplyTool(services));
      pi.registerTool(createTaskClaimTool(services));
      pi.registerTool(createTaskReleaseTool(services));
      pi.registerTool(createRosterTool(services));
      registered = true;
    } catch (error) {
      await logger.error("runtime binding failed", error);
      if (ctx.hasUI)
        ctx.ui.notify(
          `Mycelial inactive: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
    }
  });
  pi.on("session_shutdown", async () => {
    await runtime.stop();
  });
}
