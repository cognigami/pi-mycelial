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
  just --justfile '{{justfile()}}' build-rotate

# Standalone operator executable, using the sibling webgrab build pattern.
build-rotate output="cli-dist/rotate":
  {{bun}} build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig src/rotate.ts --outfile '{{output}}'

clean: sync
  {{bun}} {{tooling}} clean

compile: sync
  {{bun}} {{tooling}} compile

install: build
  {{bun}} {{tooling}} install
  just --justfile '{{justfile()}}' install-rotate

install-rotate directory=(env_var("HOME") / "mycelial"):
  mkdir -p '{{directory}}'
  install -m 755 cli-dist/rotate '{{directory}}/rotate'

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
