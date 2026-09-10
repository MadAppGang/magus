# Code Analysis Plugin

Read-only codebase investigation. `code_search` is always present; structural tools appear only
when the configured search engine genuinely supports them. The engine is named in project
settings and is swappable.

Run `/code-analysis:help` for the tool surface and `/code-analysis:setup` to see which engine is
active and whether it is healthy.

## No external models, and no runtime dependency

This plugin contacts no model provider. Its MCP server shells out to whichever search engine
project settings name, and its agent and skills run on the host's own model.

**It used to declare a dependency on `claudish` and no longer does (7.2.0).** The declaration
was residue: `code-analysis` once shipped the `claudish` MCP server inside its own `.mcp.json`
for in-conversation model queries, that server was extracted into a plugin of its own in May
2026, and the dependency was declared in its place. Nothing here ever called it — searching
the plugin's whole history for a claudish tool invocation returns no commit.

Keeping it was not free. An unsatisfied dependency makes the Claude Code CLI refuse to load
the **entire** plugin, and it reports that only in `claude plugin list`. The failure is
otherwise silent: no error, no tools, and every `code_search` call simply absent. It also
dragged `OPENROUTER_API_KEY` into the requirements of a plugin that never contacts OpenRouter.

If you want an external model for an investigation, invoke `claudish` yourself; it is a
separate plugin and stands alone.
