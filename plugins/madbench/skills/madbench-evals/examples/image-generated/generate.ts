#!/usr/bin/env bun
// Build this run's picture and hold its answer back.
//
//   $MADBENCH_TESTDATA_DIR  becomes the agent's working tree (and is our cwd)
//   $MADBENCH_IMAGE_DIR     does NOT — it is where `image: generated:…` looks
//
// madbench executes this file directly, so it keeps its shebang and its executable bit.
// stdout is the secret channel (NAME=VALUE only). stderr is for diagnostics.

// A 1x1 PNG, so the file is a real image and nothing else has to be installed.
const DOT_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const imageDir = process.env.MADBENCH_IMAGE_DIR;
if (!imageDir) {
  console.error("MADBENCH_IMAGE_DIR is not set — run this through madbench, as generate:");
  process.exit(1);
}

await Bun.write(`${imageDir}/dot.png`, Buffer.from(DOT_PNG_B64, "base64"));

console.error("This run: 1x1 PNG written to $MADBENCH_IMAGE_DIR/dot.png");
console.log("DOT_PIXELS=1");
