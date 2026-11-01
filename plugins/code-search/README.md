# Code Search Plugin

Read-only codebase investigation. `code_search` is always present; structural tools appear only
when the configured search engine genuinely supports them. The engine is named in project
settings and is swappable.

Run `/code-search:help` for the tool surface and `/code-search:setup` to see which engine is
active and whether it is healthy.

## New git worktrees

A new linked worktree starts with code search already working. Nothing to repeat there.

**Settings are inherited.** The worktree uses the main project's code-search settings (the
engine choice, its options, and an "ignore code search for this project" decision) as a
base layer. Layers merge key by key, lowest first: user, main project, worktree project, main
local, worktree local. The worktree's own local settings win; note that main's local settings
sit above the worktree's committed project settings.

**The index is copied when the engine allows it.** For an engine whose index can be copied
safely, the first session started in the new worktree begins from a copy of the main
project's index instead of indexing from zero:

1. If the main project's index is behind the main checkout's latest commit, it is brought up
   to date first, with the engine's own update command.
2. The index is copied into the worktree. Main's copy is never changed by the copy.
3. The engine's own update command then runs in the worktree, so the files the worktree has
   changed, added or deleted are reflected before the first search.
4. The result is checked: files the engine indexes must be found, deleted files must be gone.

You see one line when it finishes, for example "Started from the main project's index,
brought up to date first; 4 changed files updated." The start is silent when nothing was
needed: the worktree already has an index, the engine is not copyable, or the project is not
a linked worktree.

**If it cannot finish**, the partly copied index is removed and the session says so
("Could not start from the main project's index, so this worktree has no index yet."). Code
search then offers the normal setup question. The next session start does not retry on its
own. Searches made while a copy is still being prepared answer that the index is not ready
yet, rather than returning results from a half-built index.

**If the worktree cannot take a copy**, nothing is copied and nothing is deleted. That is the
case when the engine's index location in the worktree is a link or a folder where the index
file belongs, or when the project commits a file inside the engine's index folder (a committed
engine config, for instance). The session says the same line as above, code search offers the
normal setup question, and the next start does not retry. A worktree that already has its own
index file is left alone and silent. When the main project's index was built over uncommitted
changes, the line says "changed files updated" without a count.

**A start that was cut short** (the session was killed while copying) is cleaned up by the
next session start in that worktree, whatever the settings are by then, and the setup question
follows when code search is still wanted there.

**Index the main project first.** If the main project has no index yet, there is nothing to
copy, so the new worktree gets the normal setup question with one added line: index the main
project first, so future new worktrees start from a copy and do not need a full reindex.

**Which engines copy.** Only an engine whose copy was measured on a real install is
declared copyable. Today that is codegraph. graphify keeps absolute paths in its index and
records no commit state, so it is built per worktree as before; serena has no index to copy.
**mnemex manages its own worktrees**: nothing is copied for it, no setup question is raised
while the main project has an index, and it finds that index itself.

## No external models, and no runtime dependency

This plugin contacts no model provider. Its MCP server shells out to whichever search engine
project settings name, and its agent and skills run on the host's own model.

**It used to declare a dependency on `claudish` and no longer does (7.2.0).** The declaration
was residue: `code-search` once shipped the `claudish` MCP server inside its own `.mcp.json`
for in-conversation model queries, that server was extracted into a plugin of its own in May
2026, and the dependency was declared in its place. Nothing here ever called it — searching
the plugin's whole history for a claudish tool invocation returns no commit.

Keeping it was not free. An unsatisfied dependency makes the Claude Code CLI refuse to load
the **entire** plugin, and it reports that only in `claude plugin list`. The failure is
otherwise silent: no error, no tools, and every `code_search` call simply absent. It also
dragged `OPENROUTER_API_KEY` into the requirements of a plugin that never contacts OpenRouter.

If you want an external model for an investigation, invoke `claudish` yourself; it is a
separate plugin and stands alone.
