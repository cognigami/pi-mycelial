import type { RoleId } from "../identifiers";
import {
  publicWakeOutcome,
  type WakeDispatcher,
  type WakeOutcome,
  wakeOutcomeText,
} from "./wake";

export type AutomaticNotificationOutcome =
  | WakeOutcome
  | { status: "skipped-self"; recipient: RoleId };

export async function notifyDelivered(
  dispatcher: WakeDispatcher,
  sender: RoleId,
  recipients: RoleId[],
  signal?: AbortSignal
): Promise<AutomaticNotificationOutcome[]> {
  return Promise.all(
    recipients.map((recipient) =>
      recipient === sender
        ? Promise.resolve({ status: "skipped-self" as const, recipient })
        : dispatcher.wake(recipient, signal)
    )
  );
}

export function notificationText(
  outcomes: AutomaticNotificationOutcome[]
): string {
  if (outcomes.length === 0) return "";
  return ` ${outcomes
    .map((outcome) =>
      outcome.status === "skipped-self"
        ? `Automatic wake-up skipped for sender role ${outcome.recipient}.`
        : wakeOutcomeText(outcome)
    )
    .join(" ")}`;
}

export function publicNotificationOutcomes(
  outcomes: AutomaticNotificationOutcome[]
): Array<
  | ReturnType<typeof publicWakeOutcome>
  | { status: "skipped-self"; recipient: RoleId }
> {
  return outcomes.map((outcome) =>
    outcome.status === "skipped-self" ? outcome : publicWakeOutcome(outcome)
  );
}
