#!/usr/bin/env bun
/**
 * PreToolUse (matcher: both claudish server names' tools) — allow claudish's read-only calls
 * before the permission check, so the status mod's poll never prompts. A mod cannot approve
 * its own calls (the engine skips a plugin's own `tool.check` hook for a call that plugin
 * raised), so this classic command hook is the route that clears the prompt.
 *
 * Why PreToolUse and not PermissionRequest (measured, Claude Code 2.1.292, claudish 10.4.1):
 * a PermissionRequest hook answers only once a call reaches the permission queue, and while
 * any other dialog is open (the model's own Write approval, the Stop's cancel question) each
 * poll queued behind it — "2 of 2" grew to "11 of 11" stacked prompts in 15 s. The same logic
 * as PreToolUse allowed all 11 polls with nothing queued.
 *
 * Identity is the EXACT tool name, from a fixed set over the two names claudish's tools carry:
 * installed through this plugin (`mcp__plugin_claudish_claudish__…`) or registered directly
 * (`mcp__claudish__…`). A suffix match is never enough, so the hook stays safe under any matcher.
 *
 * - `team` with mode list | status | capture → allow (its run and cancel modes must ask).
 * - `list_sessions`, `capture_session` → allow. Both are read-only as whole tools.
 * - anything else (a team run, a judge, a cancel, a session start or send, another server) →
 *   print nothing: the person's own rules decide.
 *
 * The model's read-only claudish calls are allowed too: they read, and change nothing. A
 * PreToolUse allow does not bypass the person's rules: Claude Code still applies a matching
 * deny rule (blocks) and ask rule (prompts). Malformed input prints nothing. Exit 0 always:
 * this hook never blocks.
 */

const SERVERS = ['mcp__plugin_claudish_claudish__', 'mcp__claudish__'] as const
const READ_MODES: ReadonlySet<string> = new Set(['list', 'status', 'capture'])
const READ_TOOLS: ReadonlySet<string> = new Set(SERVERS.flatMap(s => [`${s}list_sessions`, `${s}capture_session`]))
const TEAM_TOOLS: ReadonlySet<string> = new Set(SERVERS.map(s => `${s}team`))

/** Shown to the person, not the model; names why no question was asked. */
const REASON = 'claudish read-only call'

function isReadOnly(raw: string): boolean {
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    return false
  }
  if (typeof input !== 'object' || input === null) return false
  const { tool_name: tool, tool_input: args } = input as { tool_name?: unknown; tool_input?: unknown }
  if (typeof tool !== 'string') return false
  if (READ_TOOLS.has(tool)) return true
  if (TEAM_TOOLS.has(tool) && typeof args === 'object' && args !== null) {
    const mode = (args as { mode?: unknown }).mode
    return typeof mode === 'string' && READ_MODES.has(mode)
  }
  return false
}

try {
  if (isReadOnly(await Bun.stdin.text())) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: REASON },
      }),
    )
  }
} catch {
  // unreadable stdin: say nothing, the person's rules decide
}
