#!/usr/bin/env node
/**
 * Claudeup Sidecar Server
 * Stdio JSON-RPC 2.0 server for claudeup-gui
 *
 * Communication Protocol:
 * - Reads newline-delimited JSON from stdin
 * - Writes newline-delimited JSON to stdout
 * - Emits "SIDECAR_READY" on stderr when ready
 */

import { createInterface } from 'readline';
import { handleRpcRequest } from './rpc-handler.js';
import { JSON_RPC_ERRORS } from './types.js';

// Create readline interface for stdin/stdout
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// Process each line as a JSON-RPC request
rl.on('line', async (line: string) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRpcRequest(request);

    // Write response to stdout with newline
    console.log(JSON.stringify(response));
  } catch (error) {
    // Parse error - respond with JSON-RPC error
    const errorResponse = {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.PARSE_ERROR,
        message: 'Parse error',
        data: {
          error: String(error),
        },
      },
      id: null,
    };
    console.log(JSON.stringify(errorResponse));
  }
});

// Handle readline errors
rl.on('error', (error) => {
  process.stderr.write(`SIDECAR_ERROR: ${error.message}\n`);
  process.exit(1);
});

// Handle process signals for graceful shutdown
process.on('SIGTERM', () => {
  process.stderr.write('SIDECAR_SHUTDOWN: Received SIGTERM\n');
  rl.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  process.stderr.write('SIDECAR_SHUTDOWN: Received SIGINT\n');
  rl.close();
  process.exit(0);
});

// Signal that sidecar is ready to receive requests
process.stderr.write('SIDECAR_READY\n');
