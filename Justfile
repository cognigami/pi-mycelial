set script-interpreter := ["bash", "-eu", "-o", "pipefail"]
set positional-arguments

bun := require("bun")
tooling := "../pi-extension-kit/scripts/tooling.ts"

default:
  @just --list --justfile '{{justfile()}}'

sync:
  {{bun}} {{tooling}} sync

build: clean compile test lint
  {{bun}} {{tooling}} package

clean: sync
  {{bun}} {{tooling}} clean

compile: sync
  {{bun}} {{tooling}} compile

install: build
  {{bun}} {{tooling}} install

[script]
lint *paths: sync
  {{bun}} {{tooling}} lint "$@"

[script]
test *paths: sync
  {{bun}} {{tooling}} test "$@"

# Explicit operator control-shell operation; never an agent tool.
[script]
rotate *args:
  {{bun}} --no-install src/rotation-cli.ts "$@"

# Disposable synthetic corpus only; never advances a live mailbox cursor.
benchmark-mailbox: sync
  {{bun}} src/mailbox-benchmark.ts
