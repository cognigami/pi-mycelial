export const FOOTER_SET_SLOT_EVENT = "footer:set-slot";
export const FOOTER_CLEAR_SLOT_EVENT = "footer:clear-slot";
export const MYCELIAL_FOOTER_SLOT = "mycelial";

export interface FooterEventBus {
  emit(eventName: string, data: unknown): void;
}

export interface FooterBinding {
  mission: string;
  role: string;
}

/** Best-effort publication of the trusted Mycelial binding for operator UI only. */
export function reportMycelialFooterSlot(
  events: FooterEventBus,
  binding?: FooterBinding
): void {
  try {
    if (binding) {
      events.emit(FOOTER_SET_SLOT_EVENT, {
        slot: MYCELIAL_FOOTER_SLOT,
        value: `${binding.role}@${binding.mission}`,
      });
      return;
    }
    events.emit(FOOTER_CLEAR_SLOT_EVENT, { slot: MYCELIAL_FOOTER_SLOT });
  } catch {
    // Footer support is optional and must not affect mailbox activation.
  }
}
