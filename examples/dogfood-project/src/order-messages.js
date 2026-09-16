export const PRIORITIES = ["P0", "P1", "P2", "P3"];

/**
 * @typedef {object} MessageSummary
 * @property {string} id
 * @property {"P0" | "P1" | "P2" | "P3"} priority
 * @property {string} created
 */

/**
 * Return message summaries in deterministic handling order.
 *
 * @param {readonly MessageSummary[]} messages
 * @returns {MessageSummary[]}
 */
export function orderMessages(messages) {
  return [...messages].sort((left, right) => {
    const priorityOrder =
      PRIORITIES.indexOf(left.priority) - PRIORITIES.indexOf(right.priority);

    if (priorityOrder !== 0) return priorityOrder;
    if (left.created < right.created) return -1;
    if (left.created > right.created) return 1;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
}
