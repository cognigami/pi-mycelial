import type { MycelialConfig } from "../config";
import type { MailboxStore } from "../mailbox-store";
import type { ProjectionStore } from "../projections";
import type { TrustedIdentity } from "../protocol";
export interface ToolServices {
  mailbox: MailboxStore;
  projections: ProjectionStore;
  identity: TrustedIdentity;
  config: MycelialConfig;
}
export function textResult(text: string, details: unknown = {}) {
  return { content: [{ type: "text" as const, text }], details };
}
