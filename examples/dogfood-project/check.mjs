import assert from "node:assert/strict";
import { orderMessages } from "./src/order-messages.js";

const messages = [
  { id: "later-p2", priority: "P2", created: "2026-01-02T00:00:00.000Z" },
  { id: "p0", priority: "P0", created: "2026-01-03T00:00:00.000Z" },
  { id: "b", priority: "P1", created: "2026-01-01T00:00:00.000Z" },
  { id: "a", priority: "P1", created: "2026-01-01T00:00:00.000Z" },
  { id: "early-p2", priority: "P2", created: "2026-01-01T00:00:00.000Z" },
  { id: "p3", priority: "P3", created: "2025-01-01T00:00:00.000Z" },
];
const snapshot = structuredClone(messages);
const ordered = orderMessages(messages);

assert.deepEqual(
  ordered.map((message) => message.id),
  ["p0", "a", "b", "early-p2", "later-p2", "p3"]
);
assert.deepEqual(messages, snapshot, "orderMessages mutated its input");
assert.notStrictEqual(
  ordered,
  messages,
  "orderMessages returned its input array"
);

console.log("message ordering checks passed");
