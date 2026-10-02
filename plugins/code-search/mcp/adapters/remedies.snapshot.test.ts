/**
 * remedies.snapshot.test.ts — every adapter remedy string, pinned character for character.
 *
 * A remedy is the one line a user copies into a terminal when an engine is missing, down,
 * or unindexed. These strings were hand-written in each adapter; they are now rendered
 * from `catalog.ts`, the single table of per-engine install and start facts. That move is
 * only safe if it changes nothing a user sees, so this file was written and run green
 * BEFORE the refactor, against the hand-written constants, and must stay green after it.
 *
 * The expected values are literals on purpose, not a `toMatchSnapshot()` file: a snapshot
 * file regenerates with one flag and nobody reads the diff, while an edit here is a
 * reviewed change to text users act on. Change a remedy deliberately by editing both the
 * catalog and the literal below in the same commit.
 *
 * Run: bun test plugins/code-search/mcp/adapters/remedies.snapshot.test.ts
 */

import { describe, expect, test } from "bun:test";
import { START_REMEDY as CODEGRAPH_START } from "./codegraph/index";
import { START_REMEDY as GRAPHIFY_START } from "./graphify/index";
import { INDEX_REMEDY as MNEMEX_INDEX, INSTALL_REMEDY as MNEMEX_INSTALL } from "./mnemex/index";
import { START_REMEDY as SERENA_START } from "./serena/index";

describe("adapter remedies are unchanged", () => {
  test("mnemex install", () => {
    expect(MNEMEX_INSTALL).toBe("bun install -g mnemex");
  });

  test("mnemex index", () => {
    expect(MNEMEX_INDEX).toBe("mnemex index");
  });

  test("serena start", () => {
    expect(SERENA_START).toBe(
      "serena start-mcp-server --context claude-code --project-from-cwd  (check the project is activated)",
    );
  });

  test("codegraph start", () => {
    expect(CODEGRAPH_START).toBe(
      "codegraph serve --mcp  with CODEGRAPH_MCP_TOOLS=explore,node,search,callers,callees,impact,files,status  " +
        "(and `codegraph init` in the project, once — without an index the server lists only codegraph_explore)",
    );
  });

  test("graphify start keeps the extra quoted", () => {
    expect(GRAPHIFY_START).toBe(
      // Changed deliberately (A16): graphifyy 0.9.50 declares `graphify-mcp` as an
      // unconditional console script, so the old closing clause — the extra "is what puts
      // `graphify-mcp` on PATH" — was false. The extra supplies the `mcp` import.
      'uv tool install "graphifyy[mcp]"  then  graphify update <path> --no-cluster  ' +
        "(the [mcp] extra is required: without it `graphify-mcp` is still on PATH but cannot start, " +
        "because the `mcp` library it imports is missing)",
    );
  });
});
