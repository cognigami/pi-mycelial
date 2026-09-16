# Message Ordering Dogfood Mission

## Goal

Use Mycelial and Herdr to coordinate implementation of the intentionally incomplete message-ordering exercise under `examples/dogfood-project/`.

## Canonical artifacts

- Repository `AGENTS.md`
- `examples/dogfood-project/AGENTS.md`
- `examples/dogfood-project/README.md`
- `examples/dogfood-project/check.mjs`

## Roles

- **coordinator:** send one implementation request, wake the implementer through Herdr after durable delivery, and verify the reported result.
- **implementer:** acknowledge and claim the request, implement the specification, run the acceptance check, and report through the original thread.

## Coordination

- Load the `mycelial-coordination` skill before using the mailbox.
- Use the implementation request's message ID as both the task ID and source message ID.
- Durable mail must succeed before either role sends a body-free Herdr poke.
- The implementer must reply with changed paths and the `just check` result before marking the request done and releasing the claim.
- The mailbox is the durable record; Herdr is only the live wake-up path.

## Exit criterion

`just check` passes in `examples/dogfood-project/`, and the mission records a complete send, read, acknowledgement, claim, reply, done, and release cycle.
