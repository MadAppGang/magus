#!/usr/bin/env bun
/**
 * CLI bridge for debug-capture hooks.
 * Reads hook JSON from stdin, calls the appropriate handler, writes result to stdout.
 */

import { handlePreToolUse, handlePostToolUse } from './debug-capture';

const mode = process.argv[2]; // "pre" or "post"

let input = '';
for await (const chunk of Bun.stdin.stream()) {
  input += new TextDecoder().decode(chunk);
}

try {
  const context = JSON.parse(input);

  if (mode === 'pre') {
    const result = await handlePreToolUse({
      toolName: context.tool_name || '',
      parameters: context.tool_input || {},
    });
    // Hook shell scripts just need to exit cleanly; no stdout needed for passthrough
  } else if (mode === 'post') {
    const result = await handlePostToolUse({
      toolName: context.tool_name || '',
      parameters: context.tool_input || {},
      result: context.tool_result || null,
      success: context.tool_result !== undefined,
    });
  }
} catch {
  // Silently fail — debug capture should never break tool execution
}
