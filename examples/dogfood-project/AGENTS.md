# Dogfood Project Guidance

- Implement only the behavior specified in `README.md`.
- Add no dependencies.
- Keep `orderMessages` pure and do not mutate its input.
- Run `just check` before reporting completion; do not invoke `bun` directly.
- Report the changed paths and check result through the Mycelial thread before releasing the claim.
