#!/bin/sh
# Build this run's picture and hold its answer back.
#
#   $MADBENCH_TESTDATA_DIR  becomes the agent's working tree (and is our cwd)
#   $MADBENCH_IMAGE_DIR     does NOT — it is where `image: generated:…` looks
#
# stdout is the secret channel (NAME=VALUE only). stderr is for diagnostics.
# Standard tools only — a bench nobody can run is not a bench.
set -eu

# A 1x1 PNG, so the file is a real image and nothing else has to be installed.
DOT_PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

printf '%s' "$DOT_PNG_B64" | base64 -d > "$MADBENCH_IMAGE_DIR/dot.png"

printf 'This run: 1x1 PNG written to $MADBENCH_IMAGE_DIR/dot.png\n' >&2
echo "DOT_PIXELS=1"
