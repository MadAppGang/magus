---
name: setup
description: "Set up code-search in this project: choose, install and configure a search engine, build its index, and verify. Asks before every change, and undoes an earlier ignore-for-this-project."
argument-hint: "[what to set up, change or upgrade]"
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

<user_request>$ARGUMENTS</user_request>

Read `${CLAUDE_PLUGIN_ROOT}/skills/setup/SKILL.md` in full, then follow it from step 1.

The plugin root it calls `<root>` is `${CLAUDE_PLUGIN_ROOT}`. The project root it calls
`<project>` is the directory this session was started in.

If the request above names something narrower (one engine, an upgrade, only the index, or
removing the code-search 8.1 `rg` shim with `remove-rg-shim`), still run step 1 first, then
go to the step that covers it.

Once an engine is configured, the step 10 report carries this line verbatim:

> Bash `grep` appends related locations from the index, starting with your next session. To start now: reconnect `ca` in `/mcp`, then run `/clear`. Turn it off with `grep.route: false` in settings, or `CODE_SEARCH_MERGE=0` on one command. It does not run inside Claude Code's Bash sandbox. The block may name files that a Read deny rule hides from the Grep tool.
