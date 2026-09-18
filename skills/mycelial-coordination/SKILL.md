---
name: mycelial-coordination
description: Use Mycelial durable mailbox and task-claim tools for multi-agent coordination. Load when agent_mail_* tools are available or when joining a declared Mycelial mission.
---

# Mycelial Coordination

Use the durable mailbox as coordination truth. Never invent or pass mission, role, sender, or session identity fields; Mycelial derives them from the trusted runtime binding.

## Start and check in

1. Call `agent_mission_read` to load the mission selected by the trusted binding, then read the active repository's `AGENTS.md`.
2. Call `agent_roster` with `refresh: true` to publish this session's presence and see live sessions.
3. Call `agent_mail_read` before starting new work.
4. Check mail again at atomic task boundaries and before ending a work turn. Do not poll continuously.

Treat P0 as emergency mail to handle at the next safe point. Treat P1 as blocking mail to acknowledge promptly after the current atomic operation. Follow each message's interrupt and acknowledgement metadata.

## Conversations and receipts

Use `agent_mail_reply` for an existing conversation so reply and thread linkage remain intact. Use `agent_mail_ack` to record the appropriate state:

- `seen`: read but not committed;
- `accepted`: committed to handle it;
- `declined`: cannot take it;
- `delegated`: handed to another role, with delegation detail;
- `done`: requested work and reporting are complete.

When a message requires acknowledgement, append an appropriate receipt promptly. Reading or roster presence is not an acknowledgement.

## Claim work safely

For one independently claimable request, use the request message ID as both the default task ID and source message ID. Call `agent_task_claim` before starting work.

- If the claim is contended, do not perform the work; coordinate through mail or choose another task.
- Renew an owned claim before its lease expires when work continues.
- Roster presence and `accepted` receipts do not establish ownership; only a live claim does.
- Before `agent_task_release`, report the result and validation through the existing mail thread, then release the claim.

## Optional live wake-up

When `agent_wake` is available, call it for the recipient role only after durable `agent_mail_send` or `agent_mail_reply` succeeds. The tool sends a fixed Herdr notification with no task content and validates the target against the mission roster. The durable mailbox remains authoritative if wake-up fails. Do not depend on Herdr for storage, acknowledgement, or ownership.
