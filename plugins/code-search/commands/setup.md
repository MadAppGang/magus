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

If the request above names something narrower (one engine, an upgrade, only the index), still
run step 1 first, then go to the step that covers it.
