/**
 * jsonrpc.ts — JSON-RPC 2.0 message types and newline-delimited framing.
 *
 * Shared by both halves of the facade: `mcp-stdio-client.ts` speaks it to the six
 * engines, `server.ts` speaks it to the host. One module so the two cannot drift.
 *
 * Framing is NDJSON — one JSON value per line — not LSP `Content-Length`. That is
 * what MCP stdio servers actually emit, and it is what this repo's own server half
 * already does (`benches/claudish-agent-routing/mcp-recorder.ts`).
 *
 * No library. `@modelcontextprotocol/sdk` is not a dependency of this repo, and a
 * published plugin ships without `node_modules` and gets no install step — a runtime
 * dependency here would fail at session start on every fresh install and surface as
 * "MCP server unavailable" with no cause.
 */

export type RpcId = number | string;

export interface RpcRequest {
  jsonrpc: "2.0";
  id: RpcId;
  method: string;
  params?: unknown;
}

/** A request with no `id`. Expects, and must not receive, a response. */
export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: RpcError;
}

/** Serialise one message as a framed line. The trailing newline IS the frame. */
export function encode(msg: object): string {
  return `${JSON.stringify(msg)}\n`;
}

/**
 * Build a chunk handler that reassembles NDJSON across arbitrary chunk boundaries.
 *
 * A pipe splits wherever it likes: one message can arrive in four chunks, and four
 * messages can arrive in one. The returned function is therefore stateful and must
 * be the only consumer of a given stream.
 *
 * A line that is not JSON is DROPPED, not reported. Engines print startup banners and
 * progress lines to stdout, and a banner must not take the client down — the design's
 * whole point is that one early failure stops the agent using the tool for the rest of
 * the session. A message lost this way is caught by the caller's per-call timeout.
 */
export function makeLineReader(onMessage: (m: unknown) => void): (chunk: string) => void {
  let buffer = "";

  return (chunk: string) => {
    buffer += chunk;

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      onMessage(parsed);
    }
  };
}
