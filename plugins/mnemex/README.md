# Mnemex Plugin

Provides the **Mnemex MCP runtime** for the Magus marketplace. Mnemex is a
semantic code search and AST analysis tool that exposes structural code
navigation (callers, callees, references, PageRank-ranked results) via MCP.

This plugin is a **runtime dependency**. Other plugins (`code-analysis`, `dev`)
declare it via the `dependencies` field in their `plugin.json` and consume its
tools through standard MCP.

## Why this plugin exists

Originally Mnemex was declared inside `code-analysis/.mcp.json`, but `dev` also
referenced its tools without declaring them — relying on `code-analysis` being
installed. Extracting the runtime into a dedicated plugin makes the dependency
explicit and follows Anthropic's documented `dependencies`-field pattern
(Claude Code v2.1.110+).

See: [Anthropic plugin dependencies docs](https://code.claude.com/docs/en/plugin-dependencies)

## Requirements

The `mnemex` CLI tool must be on `$PATH`. See [mnemex installation](https://github.com/MadAppGang/mnemex)
for setup; the `MNEMEX_LSP=true` env var is set automatically.

## What it provides

Tools exposed via the `mnemex` MCP server (sample):

- **Structural**: `callers`, `callees`, `define`, `references`, `symbol`,
  `context`, `hover`
- **Indexing**: `index_codebase`, `reindex`, `index_status`, `clear_index`
- **Editing**: `edit_lines`, `edit_symbol`, `rename_symbol`, `restore_edit`
- **Analysis**: `dead_code`, `impact`, `map`, `test_gaps`
- **Memory**: `memory_read`, `memory_write`, `memory_list`, `memory_delete`
- **Search**: `search`, `search_code`

## Used by

This is a runtime dependency of:

- `code-analysis` — semantic code search and analysis commands
- `dev` — `/dev:investigate` and other code-navigation flows

If you are installing Magus, this plugin is auto-installed when either of the
above is enabled.
