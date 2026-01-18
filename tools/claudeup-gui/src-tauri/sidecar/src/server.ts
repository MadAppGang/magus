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
import { writeFileSync } from 'fs';
import { handleRpcRequest } from './rpc-handler.js';
import { JSON_RPC_ERRORS } from './types.js';

// Create readline interface for stdin only (we handle stdout separately)
const rl = createInterface({
  input: process.stdin,
  terminal: false,
});

// Write to stdout in chunks to handle large responses
// macOS pipe buffer is 64KB, so write in smaller chunks to avoid issues
function writeOutput(data: string): void {
  const output = data + '\n';
  const CHUNK_SIZE = 16 * 1024; // 16KB chunks (well under 64KB pipe buffer)

  try {
    for (let i = 0; i < output.length; i += CHUNK_SIZE) {
      const chunk = output.slice(i, i + CHUNK_SIZE);
      writeFileSync(1, chunk);
    }
  } catch (error) {
    process.stderr.write(`SIDECAR_WRITE_ERROR: ${error}\n`);
    process.stderr.write(`Output length was: ${output.length}\n`);
  }
}

// Process each line as a JSON-RPC request
rl.on('line', async (line: string) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRpcRequest(request);

    // Write response to stdout with newline
    writeOutput(JSON.stringify(response));
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
    writeOutput(JSON.stringify(errorResponse));
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
