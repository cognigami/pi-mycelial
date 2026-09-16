# Example Mission

Deliver the approved authentication retry fix across the application and shared library repositories, with implementation and independent review completed before release.

## Canonical references

- `app`: repository `AGENTS.md`, `docs/auth-retry-design.md`, and `docs/auth-retry-plan.md`
- `shared-library`: repository `AGENTS.md` and `docs/retry-contract.md`

## Roles

- **coordinator:** decomposes and routes work, tracks blockers, and accepts final results.
- **implementer:** claims request messages, implements the scoped change, and reports validation.
- **reviewer:** claims independent review requests and reports findings or approval.

## Coordination conventions

- Send one independently claimable task per request message and use its message ID as the default task ID.
- Claims—not roster presence or accepted receipts—establish ownership.
- Report results and validation before releasing a claim.
