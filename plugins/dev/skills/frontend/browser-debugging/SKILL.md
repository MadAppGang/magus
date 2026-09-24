---
name: browser-debugging
description: "Drives a real browser — claude-in-chrome or browser-use — to verify a UI change, read console and network activity, and reproduce browser-only bugs. Use when checking UI in a running app or chasing a console error."
disable-model-invocation: true
---

# Browser debugging

Settle a UI question with evidence from a running browser — what renders, what the console
reports, what the network did — instead of inferring it from source. A finding is
something you observed on the page. Say which revision of the code it depicts, at which
URL and viewport, and what you did not check.

Paths in this file are relative to the dev plugin root: the directory that holds
`skills/` and `knowledge/`, three levels above this file's folder.

## Who can run this

Browser tools live in the main session. No dev agent has them — every agent in `agents/`
declares a `tools:` list of file and shell tools only. An agent that reads this file
without browser tools reports the browser check as not performed and names the
observation that would settle it. It never describes a page it did not see.

When a subagent needs visual evidence, the main session supplies it as a file path;
`dev:frontend-developer` reads images with Read. Producing that file is not automatic —
see [Screenshots as files](#screenshots-as-files).

## Choose the browser

Two MCP servers can provide a browser, and either may be absent. Their tools are often
deferred — listed by name, with the schema loaded through ToolSearch — so look for the
prefix in the tool list rather than probing with a call.

| | claude-in-chrome | browser-use@magus |
|---|---|---|
| Tool prefix | `mcp__claude-in-chrome__` | `mcp__plugin_browser-use_browser-use__` |
| Browser | the user's own Chrome, with their logins | a Chromium the server launches, fresh profile, headed by default |
| Console | `read_console_messages` | no tool |
| Network | `read_network_requests` | no tool |
| Screenshot | `computer` screenshot action; `zoom` for a region | `browser_screenshot`, optionally full page |
| Viewport size | `resize_window` | no tool |
| JavaScript in the page | `javascript_tool` | `browser_evaluate` |
| Addressing elements | `ref_N` from `read_page` or `find`, or coordinates | index from `browser_get_state`, or coordinates |

Prefer claude-in-chrome for console and network work, responsive checks, and pages behind
the user's login. Use browser-use when claude-in-chrome is missing, when a clean profile
matters, or for a full-page capture. They are two separate browsers: a login, cookie or
form state in one does not exist in the other.

If neither is present, say so, name what would provide one
(`/plugin install browser-use@magus`, or the Claude in Chrome extension), and continue from
the code with the gap stated.

The tool schemas are the contract for parameters. The notes below cover what the schemas
do not say.

### claude-in-chrome

- If the session lists a `claude-in-chrome` skill, load it before the first call; it
  carries the extension's current usage rules.
- Page tools act on a tab by `tabId`, taken from `tabs_context_mcp` (a standalone
  `navigate` creates the tab group for you). Work in a tab you opened, not one the user
  is using, and close yours with `tabs_close_mcp` when done unless the user wants them
  kept.
- Element references (`ref_1`, …) come from `read_page` or `find`. No tool takes a CSS
  selector; selectors belong inside `javascript_tool` code only.
- `read_console_messages` returns the current domain only. Always pass a `pattern`, and
  `onlyErrors` when errors are the question. To isolate what one action logs, read with
  `clear`, perform the action, then read again.
- `read_network_requests` is emptied when the page navigates to another domain, so read it
  before a cross-domain redirect such as an OAuth hop. `urlPattern` narrows it, for
  example to `/api/`.
- `resize_window` sizes the window, not the viewport. Read `window.innerWidth` with
  `javascript_tool` before judging a breakpoint.
- `browser_batch` runs several calls in one round trip, in order, stopping at the first
  error. Inside it every page tool needs an explicit `tabId`, and coordinates refer to the
  screenshot taken before the batch.
- A refused domain permission is the user's decision. Ask; do not route around it.

### browser-use

- The server drives one primary browser. The first `browser_*` call starts it, and the
  control tools act on it with no session argument. `browser_navigate` returns a line of
  text, not an id.
- `browser_screenshot` returns viewport metadata as text plus the image, which you see
  directly. It writes no file and returns no base64.
- Indices from `browser_get_state` go stale whenever the DOM changes; read state again
  before the next click or type.
- Ten minutes without a call closes the browser and deletes its profile, logins included.
  `browser_export_session` saves the cookies if you will need them again.
- There is no console or network tool. `browser_evaluate` gives two partial substitutes:
  a hook that records `console.error` and `window.onerror` into a global, installed before
  you reproduce and read back afterwards (a full page load discards it, so load-time errors
  need claude-in-chrome); and `performance.getEntriesByType("resource")`, which lists the
  requests the page made with their timings.
- `retry_with_browser_use_agent` runs its own separate browser and its own model, so it
  cannot see or continue the primary browser's state. It is a last resort for driving a
  page, not a debugging tool.
- Close when done: `browser_list_sessions` gives the id that `browser_close_session`
  takes.

## Workflows

### Verify a UI change

First confirm the page serves the edit: a hot reload that failed, or a screenshot taken
before the reload, is not evidence. Then look at the page and exercise what changed rather
than stopping at first paint — the interaction itself, and each state the component has
(hover, focus, disabled, loading, error, empty). With claude-in-chrome, finish with a pass
over console errors and failed requests since the page loaded.

### Chase a console error or failing request

Clear the console or network log before reproducing, so what you read belongs to the
reproduction. A stack trace from a dev server points into the served bundle; follow it to
the original source before reasoning about the cause. For a failing request, the request
body, response body and status together usually decide between client and server. Then
continue with the method in `skills/discipline/systematic-debugging/SKILL.md`: this file
supplies the observations, that one the root-cause loop.

### Responsive layout

Take the breakpoints from the project's theme or Tailwind config rather than a generic
device list, and check each side of every boundary. This needs claude-in-chrome, since
browser-use has no viewport control.

### Accessibility

Judge names, roles, labels and heading order from the accessibility tree (`read_page`;
with browser-use, `browser_get_html` or `browser_evaluate`), not from pixels. Compute
contrast from `getComputedStyle` colours, walking up to the first opaque background, rather
than estimating it from a screenshot. If the project already runs automated accessibility
checks, run those too — they repeat, a manual pass does not.

### Design fidelity

Read the reference image and look at the page. For exact colours, spacing and type, read
computed styles rather than estimating from pixels. A fix goes through the design system:
read `skills/frontend/design-system-guardrails/SKILL.md` before changing any style —
tokens only, appearance inside the library component, no hex or arbitrary value at the
call site — and check the diff with `/dev:design-system --changed`.

For a pixel diff with an external vision verdict, the designer plugin's
`/designer:review <reference> <implementation>` compares two local image files.

## Screenshots as files

Neither browser saves a screenshot to disk. claude-in-chrome returns the image to you (its
ID only feeds `upload_image`); browser-use returns an image block and metadata. When a
subagent, `/designer:review` or an external model needs a PNG, it has to come from
elsewhere: the user, a design export, or the project's own tooling — a Playwright test's
`page.screenshot`, or the Playwright CLI's `screenshot` command, which opens a fresh
browser without the user's login or the page's current state. Say which revision the file
depicts. When no file exists, the consumer reports that no screenshot was supplied.

## A second opinion from another model

You read screenshots precisely yourself, so an external model is optional. When one is
wanted:

- Resolve the model at call time with claudish `list_models` or `search_models`, choosing
  one whose capabilities include image input. A version the user names is a hard
  constraint: if the catalog lacks it, say so and show the live alternatives.
- Run it through the claudish MCP tools, never the claudish CLI. `run_prompt` carries text
  only, so an image reaches the other model as a file that a `create_session` run reads
  from its `work_dir`. Load the `claudish:claudish-usage` skill before the first call.

## Related reading

Reference files, read by path — they are not skills:
`knowledge/frontend/react-typescript.md`, `knowledge/frontend/tanstack-router.md`,
`knowledge/frontend/shadcn-ui.md` and `knowledge/frontend/testing-frontend.md`. For a
repeatable browser test rather than a one-off look, read
`skills/testing/ui-playwright/SKILL.md`.
