# Coordination Liveness: Wake Delivery, Coordinator Boundaries, and Reconciliation

## Status

Automatic post-send notification is implemented following the live
`study-guide` mission. Synthetic validation is complete; live operator-project
validation remains. A resident mission supervisor is not recommended;
reconciliation should be added only if measured failures remain after the
automatic send/reply notification path is exercised live.

## Why this note exists

The `study-guide` run exposed a gap between durable coordination state and live
agent execution. Durable mail, receipts, claims, and roster heartbeats worked,
but the operator repeatedly had to prompt the coordinator to inspect progress
and schedule the next step.

It would be misleading to call that flow healthy merely because an individual
worker had finished its current assignment. The adversarial reviewer was
locally correct to become idle after completing and releasing its review, but
the mission-level flow was still unhealthy: its completion report did not
reliably cause the coordinator to take another turn, and the operator was
manually supplying that liveness.

## Observed evidence

The live run showed all of the following:

- At 12:16:33 the coordinator durably assigned M1 to the builder and a final M0
  review to the adversarial reviewer.
- At 12:16:41 the coordinator explicitly called `agent_wake` for both workers.
- The builder acknowledged and claimed M1, then performed implementation work.
  A transient Herdr `idle` label therefore was not sufficient evidence that the
  builder had refused or abandoned the assignment.
- At 12:18:21 the reviewer durably replied with the final M0 verdict. It released
  its claims and recorded completion, but did not call `agent_wake` for the
  coordinator.
- The coordinator had already settled. Durable delivery alone did not create a
  new model turn.
- A later operator question prompted the coordinator, but that turn answered the
  question without first reading the new completion mail. This demonstrates
  that skill and prompt instructions to check mail are useful guidance, not a
  reliable execution mechanism.

Two status vocabularies also contributed to confusion:

- Herdr `idle` means that no model turn is currently active.
- Mycelial roster `online` means that the bound process still has a live
  heartbeat.

Neither status says whether actionable mail is waiting, whether a claim exists,
or whether the mission as a whole is making progress.

## Separate the responsibilities

The term “mission supervisor” risks combining several different responsibilities
that should remain separate.

### Coordinator role: semantic control plane

The coordinator is an LLM role. It should:

- decompose the approved mission;
- decide which work is ready and independent;
- assign work and review responsibilities;
- interpret worker reports and blockers;
- maintain acceptance state; and
- choose the next mission action.

This is judgment-bearing work. It is exactly what the coordinator role was
introduced to do.

### Notification adapter: mechanical doorbell

A notification adapter should only make an already durable event visible to an
idle role. It must not decide what the recipient should do. Its prompt remains
fixed and content-free, and durable mail remains authoritative.

Making send/reply trigger this adapter does not duplicate the coordinator. It is
analogous to delivering an interrupt after placing an event in a durable queue:
the coordinator still reads, interprets, and schedules the work.

### Reconciler: missed-doorbell repair

A reconciler, if eventually justified, should detect that durable actionable
state exists without a corresponding successful notification and retry or wake
the appropriate role. It must not decompose work, assign tasks, reorder
milestones, or decide acceptance.

This is narrower than a mission supervisor. Calling it a **notification
reconciler** avoids implying that it owns mission policy.

### Process supervision

Herdr remains responsible for tabs, agents, and live process control. Mycelial
should not become a second process supervisor.

## Implemented first change: automatic post-send notification

Move the normal notification attempt into the outer `agent_mail_send` and
`agent_mail_reply` workflows:

1. Validate and durably publish the message and delivery markers.
2. Only after durable publication succeeds, best-effort notify each direct
   recipient through the bounded Herdr adapter.
3. Return durable delivery and notification outcomes separately.
4. Never roll back, hide, or invalidate durable mail when notification fails.
5. Retain `agent_wake` as an explicit retry and recovery tool.

The Herdr dependency belongs in an injected outer notification service, not in
`MailboxStore`. Removing Herdr must continue to leave the durable mailbox fully
functional.

This change enforces the intended protocol in code rather than relying on every
model to remember a second tool call. It directly addresses the failure observed
when the reviewer reported completion without waking the coordinator.

### Atomicity and recovery

A filesystem mail write and an external Herdr prompt cannot be truly atomic.
The important invariant is therefore ordered, inspectable best effort:

```text
durable message first -> notification attempt second
```

Initially, reporting notification failure while preserving mail is sufficient.
If failures occur in practice, add a small durable notification outbox or marker
so reconciliation can retry after a crash between those two steps. Do not add an
outbox preemptively unless the simpler adapter produces unexplained stalls.

### Duplicate and load policy

Automatic notification makes intended wake-ups reliable, so actual model-turn
load may increase relative to the current buggy behavior. The external command
cost itself is small; unnecessary model turns are the meaningful cost.

Successful direct send/reply is followed by notification. Concurrent attempts
to wake one role share an in-flight Herdr invocation, which covers a coordinator
sending several messages to that role in one tool batch. A later wake is not
suppressed after the invocation settles because the recipient may have settled
between messages. Measure live duplicate prompts before adding any timed
coalescing window.

Priority and `interrupt` metadata should continue to govern recipient behavior
at safe boundaries. The notification contains no task content and does not
replace those semantics.

## Do not add a resident supervisor yet

Automatic send/reply notification is the minimum change that matches the
observed failure. A background watcher or periodic coordinator poller would add
new lifecycle and policy questions:

- Which process owns the watcher?
- How is ownership transferred after restart?
- How are multiple live sessions for one role handled?
- How are duplicate wakes suppressed across sender and receiver paths?
- How are busy, blocked, missing, and remote agents treated?
- Which durable events are actionable enough to justify a model turn?
- How is a wake storm prevented after restart or reconciliation?

The filesystem scan itself would be cheap at current mission sizes. The larger
risk is semantic complexity and avoidable model invocations, not CPU or I/O.

Accordingly, first implement automatic notification and instrument it. Add a
notification reconciler only if there is evidence of persisted mail whose
notification failed or was lost despite that change.

## Bounded reconciliation, if later required

If measurement justifies reconciliation, keep it deliberately narrow:

- Reconcile notification delivery, not mission scheduling.
- Wake a role only for a durable state transition requiring that role's
  attention.
- Record or derive enough notification state to avoid repeated wakes for the
  same transition.
- Debounce bursts and use a cooldown.
- Perform a low-frequency sweep only as a fallback for missed filesystem events.
- Never mutate claims, receipts, task readiness, or acceptance on behalf of the
  coordinator.
- Leave process launch and restart to Herdr and the operator.

Before considering a resident loop, validate reconciliation as an internal
operation under tests or targeted diagnostics rather than shipping a new status
surface.

## No additional user-facing status surface

Herdr already gives the operator the relevant live overview: which agents are
working, blocked, idle, or unavailable. In the observed mission, idle workers,
an incomplete mission, and silence from the coordinator were sufficient to
identify the unhealthy flow. A Mycelial dashboard or `/mycelial status` command
would duplicate that operator experience without fixing liveness.

Mycelial may need internal notification outcomes or timestamps to test and
reconcile delivery, but those are implementation evidence rather than a new
user-facing feature. Add operator UI only if a later operational need cannot be
met through Herdr and normal coordinator reporting.

A worker with no ready independent task should still be allowed to remain idle.
Maximizing agent utilization is not itself a mission goal. The unhealthy case is
ready or reported work that cannot advance because the responsible role was not
notified or did not inspect it.

## Coordinator backlog and task readiness

The coordinator should maintain enough durable planning state that it can see
ready work and dependencies when awakened. That can begin with well-structured
request threads and claim state; it does not require a new task database.

Pre-assigning or publishing independent work can reduce avoidable worker idle
time, but this remains coordinator policy. A mechanical notification adapter or
reconciler must not infer dependencies and create assignments on its own.

## Incremental delivery plan

### Phase A — Reliable doorbell — implemented

- The bounded Herdr invocation is shared through an injected notification
  dispatcher outside mailbox storage.
- Send and reply invoke it automatically after successful durable publication.
- Notification failure and cancellation preserve mail and are exposed separately.
- Explicit `agent_wake` remains available for manual retry.
- Synthetic tests cover ordering, send/reply, self-target handling, fan-out,
  in-flight duplicate coalescing, failure preservation, cancellation, launcher
  behavior, and explicit retry.
- The coordination skill no longer asks agents to make a routine second wake
  call and documents retry behavior.

### Phase B — Evidence-gated reconciliation

Only if Phase A still leaves unexplained stalls:

- add durable notification intent/status if needed;
- add an explicit reconcile operation;
- validate it manually or on demand first; and
- consider a debounced event watcher plus low-frequency sweep only after the
  ownership and duplicate-suppression rules are proven.

## Success measures

Use test results and existing logs—not a new operator dashboard—to decide
whether later phases are necessary:

- elapsed time from durable message publication to recipient `agent_start`;
- elapsed time from worker completion report to coordinator read/acknowledgement;
- count of failed and duplicate notification attempts;
- count of model turns awakened with no new actionable mail;
- count of operator prompts used solely to make the coordinator check progress;
- count of actionable messages left waiting while the recipient is online and
  idle.

The desired result is not that every agent is always busy. It is that durable
mission transitions reliably reach the role responsible for the next decision,
without the operator acting as the hidden scheduler.
