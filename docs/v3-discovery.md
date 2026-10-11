# Mycelial v3 discovery: sustainable mission attention

**Status:** discovery, not an approved design or implementation plan. The current Mycelial behavior is the v2 baseline for this discussion; “v3” names a candidate direction, not a committed protocol or topology. No code change or live-mission migration is authorized by this document.

## Product question

Can an autonomous mission stay productive as its history, participant count, and duration grow, without making the coordinator read the entire mission on every rotation or turning every uncertainty into a release gate? The operator is the product owner; the coordinator is their chief of staff. The aim is to reduce operator involvement *after design* while preserving truthful outputs, delegated authority, and real safety boundaries. Agents already spawn Pi subagents for bounded work; that useful behavior should not be suppressed by a rigid organizational chart.

Think of v3 as **networking agents sustainably**, not automatically adding another tier. The test is whether responsibility for information and decisions can be distributed so that the coordinator has less to ingest and better decisions to make. Merely adding agents and reports would make the problem worse.

## Evidence and limits

- The Benny design has a clear product purpose: show where financial stress sits, how far it has spread, and provide weekly context and a bounded hypothesis about DXY and 10Y moves. It is a diagnostic, not a trade signal (`/Users/ricardo/Documents/benny/docs/v0-design.md`, §§0–1). Clarity of purpose did not translate into a prioritized first usable output. The execution plan requires Dial D, six-leg USDX, and SR3 for deployable v0 absent operator approval of a degraded release, while the Mycelial mission exit criterion requires every deliverable and acceptance check to be complete. These concrete completion instructions competed with the broader goal. See [the Benny diagnosis](pm-benny.md).
- **Dial D is not a reason to stop A/C.** A builder can pursue Dial D and prepare a precise request for IBKR Gateway access while other lanes continue. A/C can be released for honestly labeled interim testing. Benny is not fully done until remaining requirements are completed or explicitly deprecated on evidence or with operator involvement; interim testing does not claim full-v0 release. The recent A/C retrospective run was labeled non-PIT because its rows were fetched later; forward PIT claims require actual forward observations. The current-only SR3 diagnostic likewise does not authorize a rolled or scored series. See [the Benny diagnosis](pm-benny.md).
- Brackets exposed a related, not identical, failure: a real need to reconcile broker exits expanded into extensive recovery and approval prerequisites before a controlled PAPER encounter. Broker races, stale exits, and uncertain recovery were genuine hazards; they did not by themselves require production-grade automatic recovery before a bounded PAPER experiment. The operator's risk and interruption policies needed explicit treatment. See [the Brackets diagnosis](pm-brackets.md).
- In the surviving post-rotation Benny coordinator session (`01a1288c-4b49-7d25-9c26-d458fb7693bd`, 2026-10-11), the first reported request was about 14k total tokens. Before the coordinator declared startup complete, reported per-request totals reached about 90k in under a minute. The launcher told it to read canonical artifacts, mail, requests, receipts, and claims. It loaded the plan, design, several decision/review files, status, CME documents, and replayed historical mail. Two early historical mail results alone contained roughly 82k characters. These are **request-usage figures, not an exact measurement of occupied context**; they establish that startup reconstruction was large and rapid, not which one component caused all of it. This session recorded about 48.8M cumulative request tokens across roughly 69 minutes and 333 assistant requests, with one compaction. Those cumulative tokens are not a context-window size and do not verify the operator's separate report of roughly 37M tokens within minutes after another rotation; that earlier session was removed.
- In that surviving session the coordinator also tried shell access to the external Mycelial mission directory and hit a sandbox denial. The existing `mycelial-coordination` skill and generated project guidance already say to use dedicated Pi tools, avoid `/tmp` for mission work, and stop rather than route around a denial. This is a guidance-compliance failure to test, not evidence that agents need broader shell or filesystem access.
- Earlier long-running recovery evidence records ten compactions, repeated wake prompts, many mailbox reads, growing summaries, and a model switch near a latency increase. Correlation does not identify the latency cause. Offline rotation makes an overloaded mission recoverable but does not by itself bound the *next* coordinator's startup or attention demands. See [long-running recovery design](long-running-mission-recovery-design.md) and [implementation evidence](long-running-mission-recovery-status.md).

The two project reports are retrospective hypotheses with explicit limitations, not exhaustive audits. Neither proves that every review was unnecessary or that Mycelial mail caused model latency. The surviving session supports a narrower finding: the coordinator actually reconstructed much of a large mission immediately after rotation.

## Working hypotheses

1. **Startup reconstruction is too broad.** An instruction to read all canonical artifacts and historical coordination state is appropriate for avoiding duplicate work but is unbounded in a long mission. A fresh coordinator may need current outcomes, active ownership, exceptions, and specific source pointers—not all historical reasoning. A short handoff might replace much of this work, with targeted verification when needed. Changing a prompt without changing what the agent believes it must verify may not help.
2. **Claim limits become work prohibitions.** A missing requirement can restrict a particular output's truth or authority, while independent outputs remain possible. In both projects, the concrete acceptance graph made completing another gate look safer than testing the product. Reviews sometimes caught genuine defects; the failure was making their scope and ordering automatic rather than asking what next output or safety boundary they served.
3. **Coordinator fan-in can overwhelm decision-making.** Routine worker updates, notifications, and progress reviews may compete with cross-lane decisions for context. Staff can help only if their work *replaces* raw material the coordinator would otherwise consume. A coordinator that reads every mail item and then reads staff summaries has gained a cost, not capacity.
4. **Model and tool latency are separate questions.** Repeated large requests, mailbox read cost, wake traffic, provider/model behavior, and poor task selection can reinforce each other but require different measurements and interventions. Improvements in one do not prove the others fixed.

These are falsifiable proposals, not v3 architecture requirements.

## Candidate operating contract: goal-directed, bounded autonomy

The design phase should specify the outcome and the boundaries of authority, not prescribe every discovery step. A project can remain unfinished while delivering useful, honestly bounded increments. “Done” and “available for interim testing” must have different meanings.

For each ambiguity, distinguish:

- **Empirical unknown:** formulate a falsifiable hypothesis and run the smallest informative experiment.
- **Reversible product assumption within delegated authority:** state it, use it provisionally, and define the contradiction that would revoke it.
- **Unresolved operator preference or external access:** ask a precise question or request a bounded interaction; keep independent lanes moving.
- **Safety, rights, or authority boundary:** do not cross it on a hypothesis. Name the specific action or claim it blocks and seek authorization if necessary.

A coordinator's default next step should be a truthful encounter with real inputs or behavior, not a source hunt or review simply because it produces an easily accepted artifact. Before requesting another gate, ask: **Which next output or concrete safety risk does this gate affect? What narrower experiment could decide faster?** Review an experiment for whether it is bounded and informative; review a release against its separate release claims. A reviewer should not silently turn a narrow experiment into a production certification exercise.

For a proposed experiment, an informal sentence or two can suffice: *We think X; Y observation would contradict it; try Z within these authority/exposure/cleanup limits; the result may claim A but not B.* Do not create a mandatory hypothesis registry. If an accepted plan forbids Z, surface the conflict and propose a narrow amendment rather than quietly disobeying it. In broker-facing work, explicit environment, exposure, stop, and cleanup boundaries matter; “be bold” is not authorization to place orders or invent data.

## Candidate memory and staff model

**Archive:** repository artifacts and Mycelial's durable messages, receipts, and claims remain the sources of record. No new general-purpose historical database is presumed.

**Working memory:** a bounded operational view of the current product target, interim outputs, active lanes and ownership, decisions, unresolved exceptions, and the next test. It should scale with *active work*, not total mission history. It is a navigation aid, not an authority that overrides source artifacts. Where an existing status document can serve this purpose, improve it rather than automatically creating a parallel document or provenance system. A 26 KB status document plus full plan and mail is not yet a bounded startup handoff.

Working memory must prevent an eager summary from laundering uncertainty into fact. Distinguish observation, provisional assumption, operator decision, and unresolved contradiction; include concise pointers to the underlying artifact or mail thread and indicate what claim remains unauthorized. For example, a retained-contract SR3 mismatch check may support a current-only diagnostic without establishing an exchange-certified alias or rolled-series authorization. Staleness or contradiction should cause targeted inspection, not automatic acceptance or a mandatory reread of the whole archive.

**Coordinator:** owns product priority, cross-lane decisions, assignments, and escalation to the operator. It should be able to ask for source material and inspect exceptions directly, but need not carry every routine update in its conversation.

**Candidate staff functions, not fixed roles:** a lane-oriented memory/attention steward can digest routine reports and surface decisions or exceptions; a focused challenger can investigate a stall and return falsifiable alternatives, boundaries, and source pointers. These could be bounded Pi subagents rather than permanent participants. Their purpose is informational; they do not take over coordinator authority. Different missions may need none, one, or several. Adding a standing team before showing replacement of coordinator workload is premature.

The hard design question is informational access and notification. Today `agent_mail_read` addresses the bound participant's inbox with a per-session cursor; a separate participant cannot simply observe the coordinator's inbox through its own tools. If v3 requires shared observation, explore an explicitly read-only, separately identified view of relevant mail and linked state. Reading must not advance the coordinator's cursor, acknowledge its messages, claim tasks, impersonate its role, or create a second stream of routine wake prompts to the coordinator. Confidentiality is not the primary issue in these missions; command authority, integrity of the handoff, and liveness are. Decide how urgent safety exceptions reach the coordinator even if a steward is delayed, absent, wrong, or rotated. Do not assume a successful notification proves that a message was read.

Simply giving a second agent the coordinator identity, copying all mail to both, or adding a report on top of the existing full inbox would not demonstrate reduced load. Worker-spawned subagents already provide useful isolation for bounded investigations; preserve that freedom rather than routing all thinking through the coordinator.

## Guidance candidates for design, planning, and execution

A reusable **design-phase prompt** (perhaps a global Pi prompt template `/mycelial-design`) could help the product owner and agent establish:

- the user-visible outcome and first useful, real-input vertical slice;
- interim outputs and the *claims each is allowed to make*, separate from full completion and production authority;
- hard safety/rights/data boundaries, reversible assumptions, and which choices remain with the operator;
- the first falsifiable uncertainties and how to encounter them early;
- concrete negative scope, including which recovery or provenance machinery is not needed yet.

A **planning-phase companion** should order work around executable product encounters, preserve independent lanes, name external dependencies and a concise operator ask, and make each proposed review or gate justify its opportunity cost. It should not promote every acceptance criterion into a predecessor of the first test. A coordinator-facing instruction should apply the same policy during execution: choose the next useful output, classify blockers by affected claim, commission bounded tests, and escalate only decisions outside its delegated authority. Prompt placement is still open: a Pi prompt template is invoked during design/planning; mission guidance or a role instruction governs the running coordinator. Do not assume one prompt applies automatically to both.

These are **candidate behaviors**, not a new universal checklist, template, or required artifact. Pi supports user-level Markdown prompt templates under `~/.pi/agent/prompts/`; no `/mycelial-design` command has been created here. A prompt should be short enough to influence action rather than becoming another document to certify.

## Discriminating tests before v3 design

1. **Offline cold-start replay.** At a Benny decision boundary, construct the smallest source-linked working brief that lets a fresh coordinator choose the next useful action, recognize the real blockers, and avoid duplicating owned work. Compare its request size and decision with the observed large startup. Include a contradictory or stale-status case; a brief that produces confident wrong assumptions fails even if cheap.
2. **Decision-policy comparison.** Replay a Benny A/C-vs-D choice and a Brackets broker-free/PAPER-vs-production-gate choice. Ask whether design/planning/coordinator guidance yields bounded tests and correct claim limits *without* erasing PIT, source-rights, broker, or recovery hazards.
3. **Fan-in trial.** At one realistic multi-lane handoff, have a bounded staff process produce a brief from source material the coordinator does **not** also consume. Count coordinator request tokens, staff and total mission tokens, elapsed time to the next usable output, missed exceptions, and duplicated reads. A summary that saves coordinator context but increases total cost or stalls decisions still needs an explicit tradeoff, not an automatic win.
4. **Authority and liveness check.** Test whether a routine update can stay with staff while a consequential exception reaches the coordinator promptly, without shared cursors, duplicate ownership, or assuming an unread wake will eventually be serviced. This is a design question before it is a tool or protocol change.
5. **Latency attribution.** If slow turns persist after bounding startup and routine fan-in, compare comparable tasks on the relevant models and separate model response time from mailbox-tool time. The older evidence alone does not justify a model or protocol default change.

Judge success by product throughput and safety as well as coordinator context: time to first truthful output, useful interim releases, ability to continue independent work during an operator dependency, accurate escalation, recoverable cold starts, and whole-mission cost. Choose quantitative targets after measuring a realistic baseline rather than inventing thresholds here.

## Open decisions

- How much routine status may the coordinator rely on without reading original mail? What categories must always arrive directly?
- Is a small maintained section of the existing repository status sufficient as working memory, or does a distinct bounded artifact prove necessary?
- Who updates that view, when, and what is the minimal check against stale or overconfident summaries after rotation?
- Is staff on-demand enough, or does sustained coordinator fan-in justify persistent lane observers and new informational read rights? What exact material would the coordinator *stop* reading?
- What delegated authority allows interim testing and reversible product assumptions without repeated operator approval, while keeping broker, data-rights, and release decisions explicit?
- What evidence would falsify the staff hypothesis and favor simpler startup guidance plus narrower work streams instead?

The [proposed v3 design](v3-design.md) stages bounded startup and a staff trial behind these tests. Validate the cold-start and decision-policy hypotheses against real mission boundaries before approving implementation; cross-domain informational access remains contingent. No agent topology, protocol change, global prompt, or memory format is selected yet.
