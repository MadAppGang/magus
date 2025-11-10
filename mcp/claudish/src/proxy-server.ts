import {
  createStreamHeaders,
  translateAnthropicToOpenRouter,
  translateOpenRouterToAnthropic,
  translateStreamChunk,
} from "./api-translator.js";
import { OPENROUTER_API_URL, OPENROUTER_HEADERS } from "./config.js";
import type { AnthropicRequest, OpenRouterResponse, ProxyServer } from "./types.js";

/**
 * Create and start a local proxy server that translates Anthropic API to OpenRouter
 */
export async function createProxyServer(
  port: number,
  openrouterApiKey: string,
  model: string
): Promise<ProxyServer> {
  let server: ReturnType<typeof Bun.serve>;

  const serverPromise = new Promise<ReturnType<typeof Bun.serve>>((resolve, reject) => {
    try {
      server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);

          // Handle Anthropic Messages API endpoint
          if (url.pathname === "/v1/messages" && req.method === "POST") {
            return handleMessagesRequest(req, openrouterApiKey, model);
          }

          // Health check endpoint
          if (url.pathname === "/health" && req.method === "GET") {
            return new Response(JSON.stringify({ status: "ok", model, port }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          // CORS preflight
          if (req.method === "OPTIONS") {
            return new Response(null, {
              status: 204,
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "*",
              },
            });
          }

          return new Response("Not Found", { status: 404 });
        },
        error(error) {
          console.error("[Proxy Error]", error);
          return new Response("Internal Server Error", { status: 500 });
        },
      });

      resolve(server);
    } catch (error) {
      reject(error);
    }
  });

  server = await serverPromise;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    shutdown: async () => {
      server.stop();
    },
  };
}

/**
 * Handle Anthropic /v1/messages requests
 */
async function handleMessagesRequest(
  req: Request,
  apiKey: string,
  model: string
): Promise<Response> {
  try {
    const anthropicReq = (await req.json()) as AnthropicRequest;

    // Translate to OpenRouter format
    const openrouterReq = translateAnthropicToOpenRouter(anthropicReq, model);

    // Handle streaming
    if (anthropicReq.stream) {
      return handleStreamingRequest(openrouterReq, apiKey, anthropicReq.model);
    }

    // Handle non-streaming
    return handleNonStreamingRequest(openrouterReq, apiKey, anthropicReq.model);
  } catch (error) {
    console.error("[Proxy] Request handling error:", error);
    return new Response(
      JSON.stringify({
        error: {
          type: "invalid_request_error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Handle non-streaming requests
 */
async function handleNonStreamingRequest(
  openrouterReq: unknown,
  apiKey: string,
  originalModel: string
): Promise<Response> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...OPENROUTER_HEADERS,
    },
    body: JSON.stringify(openrouterReq),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Proxy] OpenRouter API error:", error);
    return new Response(error, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const openrouterRes = (await response.json()) as OpenRouterResponse;
  const anthropicRes = translateOpenRouterToAnthropic(openrouterRes, originalModel);

  return new Response(JSON.stringify(anthropicRes), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle streaming requests
 */
async function handleStreamingRequest(
  openrouterReq: unknown,
  apiKey: string,
  originalModel: string
): Promise<Response> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...OPENROUTER_HEADERS,
    },
    body: JSON.stringify(openrouterReq),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Proxy] OpenRouter streaming error:", error);
    return new Response(error, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      let isControllerClosed = false;

      const safeEnqueue = (data: Uint8Array) => {
        if (!isControllerClosed) {
          try {
            controller.enqueue(data);
          } catch (error) {
            // Controller was closed externally
            isControllerClosed = true;
          }
        }
      };

      const safeClose = () => {
        if (!isControllerClosed) {
          try {
            controller.close();
            isControllerClosed = true;
          } catch {
            // Already closed
            isControllerClosed = true;
          }
        }
      };

      // Send message_start event
      const startEvent = {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          content: [],
          model: originalModel,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      };
      safeEnqueue(
        new TextEncoder().encode(`event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`)
      );

      try {
        let hasSentStopEvent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              const translated = translateStreamChunk(line);
              if (translated) {
                // Check if this is a stop event from translateStreamChunk
                if (translated.includes('message_stop')) {
                  hasSentStopEvent = true;
                }
                safeEnqueue(new TextEncoder().encode(translated));
              }
            }
          }
        }

        // Only send message_stop if translateStreamChunk didn't already send it
        if (!hasSentStopEvent) {
          safeEnqueue(
            new TextEncoder().encode('event: message_stop\ndata: {"type":"message_stop"}\n\n')
          );
        }
      } catch (error) {
        console.error("[Proxy] Streaming error:", error);
      } finally {
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: createStreamHeaders(),
  });
}
