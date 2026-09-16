import { describe, expect, test } from "bun:test";
import {
  FOOTER_CLEAR_SLOT_EVENT,
  FOOTER_SET_SLOT_EVENT,
  reportMycelialFooterSlot,
} from "./footer-slot";

describe("Mycelial footer slot", () => {
  test("publishes only the trusted role and mission", () => {
    const emitted: Array<{ event: string; data: unknown }> = [];
    reportMycelialFooterSlot(
      {
        emit(event, data) {
          emitted.push({ event, data });
        },
      },
      { role: "implementer", mission: "release-42" }
    );
    expect(emitted).toEqual([
      {
        event: FOOTER_SET_SLOT_EVENT,
        data: { slot: "mycelial", value: "implementer@release-42" },
      },
    ]);
    expect(JSON.stringify(emitted)).not.toContain("session");
  });

  test("clears stale state for an absent binding", () => {
    const emitted: Array<{ event: string; data: unknown }> = [];
    reportMycelialFooterSlot({
      emit(event, data) {
        emitted.push({ event, data });
      },
    });
    expect(emitted).toEqual([
      { event: FOOTER_CLEAR_SLOT_EVENT, data: { slot: "mycelial" } },
    ]);
  });

  test("remains best-effort when footer support fails", () => {
    expect(() =>
      reportMycelialFooterSlot({
        emit() {
          throw new Error("no footer listener");
        },
      })
    ).not.toThrow();
  });
});
