import type {
  AnthropicRequest,
  AnthropicResponse,
  ContentBlock,
  OpenRouterMessage,
  OpenRouterRequest,
  OpenRouterResponse,
} from "./types.js";

/**
 * Translate Anthropic API request to OpenRouter format
 */
export function translateAnthropicToOpenRouter(
  anthropicReq: AnthropicRequest,
  openrouterModel: string
): OpenRouterRequest {
  const messages: OpenRouterMessage[] = [];

  // Add system message if present
  if (anthropicReq.system) {
    messages.push({
      role: "system",
      content: anthropicReq.system,
    });
  }

  // Convert Anthropic messages to OpenRouter format
  for (const msg of anthropicReq.messages) {
    const content = extractTextContent(msg.content);
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content,
    });
  }

  const result: OpenRouterRequest = {
    model: openrouterModel,
    messages,
  };

  if (anthropicReq.max_tokens !== undefined) {
    // Ensure max_tokens meets provider minimums (OpenAI requires >= 16)
    result.max_tokens = Math.max(anthropicReq.max_tokens, 16);
  }
  if (anthropicReq.temperature !== undefined) {
    result.temperature = anthropicReq.temperature;
  }
  if (anthropicReq.top_p !== undefined) {
    result.top_p = anthropicReq.top_p;
  }
  if (anthropicReq.stream !== undefined) {
    result.stream = anthropicReq.stream;
  }

  return result;
}

/**
 * Translate OpenRouter response to Anthropic format
 */
export function translateOpenRouterToAnthropic(
  openrouterRes: OpenRouterResponse,
  originalModel: string
): AnthropicResponse {
  const choice = openrouterRes.choices[0];
  if (!choice) {
    throw new Error("OpenRouter response missing choices");
  }

  return {
    id: openrouterRes.id,
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: choice.message.content,
      },
    ],
    model: originalModel, // Return the model Claude Code requested
    stop_reason: choice.finish_reason,
    usage: {
      input_tokens: openrouterRes.usage.prompt_tokens,
      output_tokens: openrouterRes.usage.completion_tokens,
    },
  };
}

/**
 * Extract text content from Anthropic message content
 */
function extractTextContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }

  // Concatenate all text blocks
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n");
}

/**
 * Create Anthropic-format streaming response headers
 */
export function createStreamHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  };
}

/**
 * Translate OpenRouter streaming chunk to Anthropic SSE format
 */
export function translateStreamChunk(line: string): string | null {
  // OpenRouter uses SSE format: "data: {...}"
  if (!line.startsWith("data: ")) {
    return null;
  }

  const data = line.slice(6).trim();

  if (data === "[DONE]") {
    return 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  }

  try {
    const chunk = JSON.parse(data);
    const delta = chunk.choices?.[0]?.delta?.content;

    if (!delta) {
      return null;
    }

    // Format as Anthropic SSE event
    const anthropicChunk = {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: delta,
      },
    };

    return `event: content_block_delta\ndata: ${JSON.stringify(anthropicChunk)}\n\n`;
  } catch {
    return null;
  }
}
