# Mycelial Dogfood Mission

## Goal

Validate Mycelial's standalone workflow by using it to coordinate an independent review of the standalone-adoption change in this repository.

## Canonical artifacts

- Repository `AGENTS.md`
- `docs/standalone-adoption-handoff.md`
- `docs/getting-started.md`
- `docs/design.md`
- The current change relative to its parent

## Roles

- **coordinator:** send one review request, wake the reviewer through Herdr after durable delivery, and triage the result.
- **reviewer:** claim the request, inspect the change, run `just build`, and reply with actionable findings and a verdict.

## Coordination

- Load the `mycelial-coordination` skill before using the mailbox.
- Use the review request's message ID as both the task ID and source message ID.
- The coordinator must complete `agent_mail_send` before issuing a body-free Herdr poke.
- The reviewer must acknowledge and claim before reviewing, then reply, mark the request done, release the claim, and poke the coordinator only after the durable reply succeeds.
- The mailbox is the durable record; Herdr is only the live wake-up path.

## Exit criterion

The coordinator receives a review reply and the mission records a complete send, read, acknowledge, claim, reply, done, and release cycle. `just build` passes, or the reviewer reports the exact blocker.
