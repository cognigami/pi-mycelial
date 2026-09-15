set script-interpreter := ["bash", "-eu", "-o", "pipefail"]
set positional-arguments

bun := require("bun")
sync_tooling := "../pi-extension-kit/scripts/tooling.ts"
tooling := "./node_modules/pi-extension-kit/scripts/tooling.ts"

default:
  @just --list --justfile '{{justfile()}}'

sync:
  {{bun}} {{sync_tooling}} sync

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
