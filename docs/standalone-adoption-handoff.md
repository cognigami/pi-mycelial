# Mycelial Standalone Adoption Handoff

## Status

Approved implementation packet. This work makes Mycelial understandable and
useful without pi-presets, while retaining Herdr as the optional live mechanism
for waking another agent. It does not add polling or a new task field.

## Goal

Make the existing v1 mailbox easy to install, understand, and use from an
ordinary repository with manually launched Pi agents. Improve the information
returned by `agent_mail_read`, give the operator a visible trusted binding in the
footer, and ship neutral package-owned coordination guidance.

## Canonical context

Read these before editing:

- `README.md`
- `docs/design.md`
- `docs/implementation-plan.md`
- `src/index.ts`
- `src/runtime.ts`
- `src/tool/read.ts`
- `../pi-presets/src/footer-slot.ts` for the existing footer-slot event pattern
- `../pi-extension-kit/docs/api.md` for managed resource installation
- `../pi-extension-kit/docs/extension-structure.md` for package structure

The managed loader already contributes package skills only for managed
extensions in its loaded set. A managed-policy-disabled Mycelial extension must
therefore contribute neither its extension nor its skill. A loaded but unbound
Mycelial extension may still advertise the skill; its description must make
actual use conditional on Mycelial tools or a declared mission.

## Approved decisions

1. **Operator identity belongs in the footer, not model context.** Show the
   trusted binding as `<role>@<mission>`. Do not expose the session ID.
2. **Mail reads expose compact actionable metadata.** Do not dump the complete
   stored record.
3. **No task field in v1.** For one claimable request, the request message ID is
   the default task ID and source message ID.
4. **No inbox polling or receiver-side notifier.** Durable mail is the source of
   truth. When Herdr is available, a sender may poke the recipient only after the
   durable send succeeds.
5. **Mycelial remains kit-managed.** The skill is package-local and declared
   through standard `pi.skills`; pi-extension-kit performs managed copying,
   manifest recording, conditional resource loading, and removal from discovery
   when the extension is disabled.

## Deliverable 1 — Short Getting Started

Create `docs/getting-started.md` and link it prominently from `README.md`.
Keep it short and operational.

Explain the boundaries:

| Artifact | Purpose | Visibility |
| --- | --- | --- |
| Repository `AGENTS.md` | Durable repository and engineering rules | Loaded by Pi |
| Mission `mission.md` | Bounded mission goal, participants, conventions, canonical artifact references | Not automatically loaded by current Mycelial |
| Design/implementation files | Canonical technical artifacts in their repositories | Read through normal file tools |
| Mail and receipts | Dynamic assignments, blockers, decisions, and handoffs | Mycelial tools |
| Claims | Current exclusive task ownership | Mycelial tools |
| Mycelial skill | Neutral mailbox/claim operating procedure | Loaded on demand |

State explicitly:

- `mission.md` supplements but never overrides repository `AGENTS.md`.
- Designs and plans normally remain in their repository and are referenced from
  `mission.md`; do not duplicate them into mission storage.
- `mission.md` is currently a required control file but is not automatically
  placed in model context. The initial prompt should direct each agent to it.
- A mission is a coordination namespace for one bounded effort and may span more
  than one repository.

Include:

1. `just install`.
2. Minimal mission creation under `~/mycelial/missions/<mission-id>/`.
3. `agents.json` setup.
4. Optional `repos.json` explanation.
5. Manual launches with `--mycelial-mission` and `--mycelial-role`.
6. A small initial prompt that identifies the role, tells the agent to read
   `mission.md` and repository `AGENTS.md`, refresh the roster, and read mail.
7. The message-ID-as-task-ID convention.
8. The limitation that an idle agent does not wake from durable mail alone.
9. Optional Herdr usage: durable send first, then a terse body-free poke to the
   role-named Herdr agent.

Do not turn Getting Started into a complete protocol reference; link to the
design for details.

## Deliverable 2 — Minimal sample mission

Add:

```text
examples/mission/
  mission.md
  agents.json
  repos.json
```

Keep `mission.md` intentionally small. It should contain only:

- one-paragraph goal;
- canonical repository/artifact references;
- role responsibilities;
- coordination conventions.

Recommended conventions:

- one independently claimable task per request message;
- use the request message ID as the default task ID;
- claims, not roster presence or accepted receipts, establish ownership;
- report results and validation before releasing work.

Use a minimal role list such as coordinator, implementer, and reviewer.
`repos.json` should demonstrate aliases without implying that v1 resolves an
alias to a filesystem path.

## Deliverable 3 — Package-owned coordination skill

Add:

```text
skills/mycelial-coordination/SKILL.md
```

Declare the package resource in `package.json`:

```json
{
  "pi": {
    "extensions": ["./dist/index.js"],
    "skills": ["./skills"]
  }
}
```

This is a package-relative path. `pi.skills` is standard Pi package metadata;
pi-extension-kit owns the managed install/load behavior in this repository.
Do not add a second global skill copy or custom resource loader.

Use valid skill frontmatter resembling:

```yaml
---
name: mycelial-coordination
description: Use Mycelial durable mailbox and task-claim tools for multi-agent coordination. Load when agent_mail_* tools are available or when joining a declared Mycelial mission.
---
```

The skill must be neutral rather than persona-specific. Cover:

- startup: refresh roster and read mail;
- checks at atomic task boundaries and before ending a work turn;
- P0/P1 urgency;
- `agent_mail_reply` for existing conversations;
- receipt states and required acknowledgements;
- claim-before-work, contention behavior, renewal, result reporting, and release;
- the message-ID-as-task-ID convention;
- roster presence is not task ownership;
- never invent or pass trusted identity fields;
- optional Herdr behavior: after durable mail succeeds, and only when Herdr is
  available, send a body-free poke to the role-named agent. The durable mailbox
  remains authoritative if the poke fails.

Do not add polling instructions, preset assumptions, routing restrictions, or
role-specific implementation/review policy.

## Deliverable 4 — Trusted binding footer slot

Follow the focused pattern in `../pi-presets/src/footer-slot.ts`. Add a small
package-owned module, for example `src/footer-slot.ts`, with no dependency on
mailbox storage.

On successful runtime binding, emit:

```ts
pi.events.emit("footer:set-slot", {
  slot: "mycelial",
  value: `${identity.role}@${identity.mission}`,
});
```

Clear it when the extension is unbound or shuts down:

```ts
pi.events.emit("footer:clear-slot", { slot: "mycelial" });
```

Requirements:

- no session ID;
- no model-context injection;
- footer support is best-effort;
- clear stale state before/after failed or absent binding;
- re-publish after successful session startup/reload;
- add focused event-payload tests.

This custom slot is separate from the managed loader's automatic extension
inventory state. Do not set `piExtensionKit.managed.footerState` merely to use a
custom footer slot.

## Deliverable 5 — Actionable `agent_mail_read` metadata

Change only model-facing read formatting and tests; do not migrate persisted
records or alter tool `details`.

Introduce a pure formatter such as:

```ts
formatMessageForModel(message: MessageRecord): string
```

Target shape:

```text
[01J8Z3K9QATG5V2N7X4R6M1B0C] P1 blocker from reviewer
created: 2026-09-13T17:32:00Z
delivery: interrupt=safe, ack=required
context: repo=pi-presets, thread=preset-handoff
deadline: 2026-09-13T18:00:00Z
paths:
- src/runtime.ts

Found a failing case in src/runtime.ts.
Please patch the regression and ask tester to verify.
```

Formatting rules:

- Always show ID, priority, kind, sender, created timestamp, and interrupt.
- Show `ack=required` only when `requires_ack` is true.
- Show repo, thread, `in_reply_to`, deadline, and paths only when present.
- Never show format version, recipient snapshot, or sender session ID.
- Preserve the body content; trim only according to the existing documented
  display behavior.
- Render metadata values safely on one line so embedded whitespace cannot forge
  another metadata header.
- Preserve existing message separators and remaining-message notice.
- Keep existing `details` unchanged.

Add focused tests for:

- a minimal message;
- a fully populated message;
- omitted optional fields;
- `requires_ack` false vs true;
- one-line normalization of metadata;
- multiple-message separation and truncation notice.

## Documentation alignment

Update `README.md` to mention the packaged skill, Getting Started, sample
mission, footer binding, and optional Herdr poke. Replace wording that implies
polling is the preferred live notification mechanism.

Adjust `docs/design.md` narrowly:

- protocol-operating guidance belongs outside storage and may come from the
  package skill, project guidance, or optional personas;
- live notification may use Herdr poke after durable send;
- no receiver-side polling notifier is planned by this work.

Update the implementation-plan status only as necessary to record these
completed standalone-adoption pieces. Do not rewrite the implemented v1 work
packages.

## Non-goals

- No receiver-side inbox polling or file watcher.
- No automatic cross-process Pi message injection.
- No new task field.
- No preset dependency or preset-to-role inference.
- No Herdr process-control implementation inside the Mycelial extension.
- No named channels.
- No claim-event history.
- No mission-content injection into model context.

## Validation

Run:

```text
just build
```

The change must pass compilation, all tests, Biome, and bundle generation.
Inspect the built package/managed manifest path handling sufficiently to confirm
that `pi.skills` is included through existing pi-extension-kit tooling; do not
reimplement installer behavior locally.

## Acceptance criteria

- A user can follow `docs/getting-started.md` without pi-presets or Herdr.
- `examples/mission/` is minimal and internally consistent.
- The package skill is discovered when Mycelial is managed-loaded and omitted
  when Mycelial is managed-disabled.
- A bound session shows `<role>@<mission>` in the footer when footer support is
  present, and stale footer state is cleared otherwise.
- `agent_mail_read` gives the model all actionable existing metadata without
  dumping provenance/internal fields.
- No polling, task field, model identity injection, or preset coupling is added.
