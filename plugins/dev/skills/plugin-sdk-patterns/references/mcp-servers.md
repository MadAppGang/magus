# MCP servers in a plugin

## Declaring a server

Put the servers in `.mcp.json` at the plugin root and point the manifest at it with
`"mcpServers": "./.mcp.json"`:

```json
{
  "search": {
    "command": "bun",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.ts"],
    "env": { "CACHE_DIR": "${CLAUDE_PLUGIN_DATA}/cache" }
  }
}
```

- Each top-level key is a server key. The plugins in the Magus marketplace use this flat
  map; Claude Code's documentation shows the same map wrapped as `{ "mcpServers": { … } }`,
  and both load.
- A server with no `type` is a stdio server. A remote one needs `"type": "http"` (or
  `"sse"`) next to its `url`; a `url` with no `type` is read as stdio and skipped with an
  error. There is no `transport` key.
- Placeholders are substituted in `command`, `args` and `env` for stdio servers, and in
  `url` and `headers` for remote ones. `${CLAUDE_PROJECT_DIR}` gives the user's project
  root.
- Plugin servers start when the plugin is enabled. Users can toggle one off in `/mcp` but
  cannot remove it there; it comes and goes with the plugin.

## How tool names are built

Claude Code names each tool `mcp__plugin_<plugin-name>_<server-key>__<tool-name>`, with any
character outside `A-Z`, `a-z`, `0-9`, `_` and `-` replaced by `_`. In a plugin named
`my-plugin`, a tool the `search` server above registers as `search_code` is called
`mcp__plugin_my-plugin_search__search_code`.

- Register the bare name, `search_code`. The prefix is Claude Code's job, so a name that
  already starts with `mcp__` is prefixed twice and matches nothing anyone writes. Where
  another guide shows a server registering a tool name that begins with `mcp__`, this rule
  wins.
- Keep the server key short. It is repeated inside every tool name, and tool names have a
  length ceiling; the code-search plugin uses the key `ca` for this reason.
- Name tools in snake_case, verb first: `search_code`, `list_sessions`.

## Referring to the tools

Use the full scoped name everywhere a plugin's tool is named:

- an agent's `tools:` line;
- a skill's or command's `allowed-tools`;
- permission rules;
- hook matchers, as `mcp__plugin_my-plugin_search__.*` with the trailing `.*`; a matcher on
  the bare server key never fires for a plugin server;
- any instruction in a skill, command or agent body that tells the model which tool to call.

Where a configured server name is expected, such as an `mcp_tool` hook's `server` field,
use `plugin:<plugin-name>:<server-key>`.

A plugin agent cannot declare its own servers; `mcpServers` in a plugin agent file is
ignored. The agent uses the servers the session has, filtered by its `tools` line.

## Dependencies and state

- Claude Code installs a plugin's npm or Bun packages into the installed copy only when the
  plugin root holds a `package.json` and a lockfile (`bun.lock`, `bun.lockb`,
  `package-lock.json` or `npm-shrinkwrap.json`). The install runs with `--ignore-scripts`
  and a 60-second limit, and it is skipped when a `bunfig.toml` sits beside a Bun lockfile
  or the only lockfile is Yarn's or pnpm's. A failed or skipped install does not stop the
  plugin loading; the server fails when it starts. Ship a lockfile, and avoid dependencies
  that need install scripts.
- A server that runs a binary the user installs (a Go binary, a globally installed CLI)
  fails at startup when the binary is missing. Name the install step in the README.
- `${CLAUDE_PLUGIN_ROOT}` is a per-version directory. Keep caches and state under
  `${CLAUDE_PLUGIN_DATA}`, which survives updates.

## Server internals

For tool schemas, error handling, and input validation inside the server, read the dev
plugin's `knowledge/mcp-standards.md`. On tool naming, this file is the one to follow.
