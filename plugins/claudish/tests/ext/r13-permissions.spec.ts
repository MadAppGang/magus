// Bun-only integration tests: the hooks-module kit cannot execute a host process.
// Keep the .spec.ts suffix separate from the kit's *.test.ts modules.
// Run from the plugin root: bun --no-env-file test ./tests/ext/r13-permissions.spec.ts
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Process boundary only: no imports of the hook, source-text assertions or copied permission logic.
const hook = fileURLToPath(new URL('../../hooks/allow-read-verbs.ts', import.meta.url))
const prefixes = ['mcp__plugin_claudish_claudish__', 'mcp__claudish__']
for (const prefix of prefixes) {
  const allowed = [
    ...['scroll_session', 'transcript_session', 'replay_session', 'close_replay'].map(tool => ({ tool, input: {} })),
    ...['scroll', 'transcript', 'replay'].map(mode => ({ tool: 'team', input: { mode } })),
  ]
  for (const c of allowed) {
    // REQ-39.
    test('TEST-21: permission hook allows ' + prefix + c.tool + ' ' + JSON.stringify(c.input), async () => {
      const result = spawnSync('bun', ['--no-env-file', hook], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: prefix + c.tool, tool_input: c.input }),
        encoding: 'utf8', timeout: 5_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      })
    })
  }
  const forbidden = [
    ...['send_input', 'cancel_session', 'create_session'].map(tool => ({ tool, input: {} })),
    ...['run', 'cancel'].map(mode => ({ tool: 'team', input: { mode } })),
  ]
  for (const c of forbidden) {
    // REQ-40.
    test('TEST-22: permission hook remains silent for ' + prefix + c.tool + ' ' + JSON.stringify(c.input), async () => {
      const result = spawnSync('bun', ['--no-env-file', hook], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: prefix + c.tool, tool_input: c.input }),
        encoding: 'utf8', timeout: 5_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
    })
  }
}
