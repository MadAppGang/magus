import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { OPENROUTER_MODELS } from "../src/types.js";
import type { AnthropicRequest, AnthropicResponse, OpenRouterModel } from "../src/types.js";
import { createProxyServer } from "../src/proxy-server.js";
import type { ProxyServer } from "../src/types.js";

// Load .env file
import { join } from "node:path";
const envPath = join(import.meta.dir, "..", ".env");
const envFile = await Bun.file(envPath).text();
for (const line of envFile.split("\n")) {
  if (line.startsWith("#") || !line.includes("=")) continue;
  const [key, ...values] = line.split("=");
  process.env[key.trim()] = values.join("=").trim();
}

// Test configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY not found in .env file");
}

// Test models (top 5 priority)
const TEST_MODELS: OpenRouterModel[] = [
  "x-ai/grok-code-fast-1",
  "openai/gpt-5-codex",
  "minimax/minimax-m2",
  "z-ai/glm-4.6", // Correct OpenRouter ID (not zhipu-ai)
  "qwen/qwen3-vl-235b-a22b-instruct",
];

// Active proxy servers (for cleanup)
const activeProxies: ProxyServer[] = [];

// Helper: Start proxy server
async function startTestProxy(
  model: OpenRouterModel,
  port: number
): Promise<ProxyServer> {
  const proxy = await createProxyServer(port, OPENROUTER_API_KEY!, model);
  activeProxies.push(proxy);
  return proxy;
}

// Helper: Make Anthropic API request to proxy
async function makeAnthropicRequest(
  proxyUrl: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AnthropicResponse> {
  const request: AnthropicRequest = {
    model: "claude-sonnet-4.5", // Fake model name - proxy will use OpenRouter model
    messages,
    max_tokens: 500,
    temperature: 0.7,
    stream: false,
  };

  const response = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Proxy request failed: ${response.status} ${error}`);
  }

  return (await response.json()) as AnthropicResponse;
}

// Cleanup after each test
afterEach(async () => {
  for (const proxy of activeProxies) {
    await proxy.shutdown();
  }
  activeProxies.length = 0;
});

describe("Claudish Integration Tests", () => {
  test("should have valid OpenRouter API key", () => {
    expect(OPENROUTER_API_KEY).toBeDefined();
    expect(OPENROUTER_API_KEY).toStartWith("sk-or-v1-");
  });

  describe("Proxy Server", () => {
    test("should start proxy server on specified port", async () => {
      const port = 3100;
      const proxy = await startTestProxy("x-ai/grok-code-fast-1", port);

      expect(proxy.port).toBe(port);
      expect(proxy.url).toBe(`http://127.0.0.1:${port}`);

      // Test health endpoint
      const health = await fetch(`${proxy.url}/health`);
      expect(health.ok).toBe(true);

      const healthData = await health.json();
      expect(healthData.status).toBe("ok");
      expect(healthData.model).toBe("x-ai/grok-code-fast-1");
    });

    test("should handle Anthropic API format requests", async () => {
      const port = 3101;
      const proxy = await startTestProxy("x-ai/grok-code-fast-1", port);

      const response = await makeAnthropicRequest(proxy.url, [
        {
          role: "user",
          content: "Say hello in one word",
        },
      ]);

      // Verify Anthropic response format
      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "message");
      expect(response).toHaveProperty("role", "assistant");
      expect(response).toHaveProperty("content");
      expect(response).toHaveProperty("usage");

      // Verify content
      expect(Array.isArray(response.content)).toBe(true);
      expect(response.content[0].type).toBe("text");
      expect(response.content[0].text).toBeTruthy();
    });
  });

  describe("Model Identity Verification", () => {
    const identityPrompt = `You must respond with ONLY your exact model name and provider.
Format: "I am [exact model name] by [provider company]."
Do not include any other text or explanation.`;

    for (const model of TEST_MODELS) {
      test(`should get response from ${model}`, async () => {
        const port = 3200 + TEST_MODELS.indexOf(model);
        const proxy = await startTestProxy(model, port);

        console.log(`\n[TEST] Testing model: ${model}`);
        console.log(`[TEST] Proxy URL: ${proxy.url}`);

        const response = await makeAnthropicRequest(proxy.url, [
          {
            role: "user",
            content: identityPrompt,
          },
        ]);

        // Extract response text
        const responseText = response.content[0].text?.toLowerCase() || "";
        console.log(`[RESPONSE] ${model}:`);
        console.log(responseText);

        // Verify it's an Anthropic-format response
        expect(response.type).toBe("message");
        expect(response.role).toBe("assistant");

        // Verify we got a meaningful response
        expect(responseText).toBeTruthy();
        expect(responseText.length).toBeGreaterThan(5);

        // Verify response contains model-specific information
        // This is evidence we're NOT getting Sonnet
        expect(responseText).not.toContain("claude");
        expect(responseText).not.toContain("anthropic");

        // Model-specific validation
        if (model.includes("grok")) {
          console.log(`[EVIDENCE] ✅ Grok model detected (xAI)`);
          // Grok should mention xAI or Grok
          const hasGrokEvidence =
            responseText.includes("grok") ||
            responseText.includes("xai") ||
            responseText.includes("x.ai");
          expect(hasGrokEvidence).toBe(true);
        } else if (model.includes("gpt") || model.includes("openai")) {
          console.log(`[EVIDENCE] ✅ OpenAI model detected`);
          // OpenAI models should mention OpenAI or GPT
          const hasOpenAIEvidence =
            responseText.includes("openai") ||
            responseText.includes("gpt") ||
            responseText.includes("chatgpt");
          expect(hasOpenAIEvidence).toBe(true);
        } else if (model.includes("minimax")) {
          console.log(`[EVIDENCE] ✅ MiniMax model detected`);
          // MiniMax should mention MiniMax
          expect(responseText).toContain("minimax");
        } else if (model.includes("glm") || model.includes("zhipu")) {
          console.log(`[EVIDENCE] ✅ GLM model detected (Zhipu AI)`);
          // GLM should mention Zhipu or GLM
          const hasGLMEvidence =
            responseText.includes("glm") ||
            responseText.includes("zhipu") ||
            responseText.includes("chatglm");
          expect(hasGLMEvidence).toBe(true);
        } else if (model.includes("qwen")) {
          console.log(`[EVIDENCE] ✅ Qwen model detected (Alibaba)`);
          // Qwen should mention Qwen or Alibaba
          const hasQwenEvidence =
            responseText.includes("qwen") ||
            responseText.includes("alibaba") ||
            responseText.includes("tongyi");
          expect(hasQwenEvidence).toBe(true);
        }

        // Additional verification: response should be unique per model
        expect(response.usage.input_tokens).toBeGreaterThan(0);
        expect(response.usage.output_tokens).toBeGreaterThan(0);
      }, 30000); // 30 second timeout for API calls
    }
  });

  describe("Multiple Models Comparison", () => {
    test("should get different responses from different models", async () => {
      const question =
        "In exactly 5 words, what is your model name?";
      const responses: Record<string, string> = {};

      // Test first 3 models for speed
      const modelsToTest = TEST_MODELS.slice(0, 3);

      for (const model of modelsToTest) {
        const port = 3300 + modelsToTest.indexOf(model);
        const proxy = await startTestProxy(model, port);

        const response = await makeAnthropicRequest(proxy.url, [
          {
            role: "user",
            content: question,
          },
        ]);

        responses[model] = response.content[0].text || "";
        console.log(`\n[${model}] Response: ${responses[model]}`);
      }

      // Verify we got responses from all models
      for (const model of modelsToTest) {
        expect(responses[model]).toBeTruthy();
      }

      // Verify responses are different (not all the same)
      const uniqueResponses = new Set(Object.values(responses));
      console.log(`\n[EVIDENCE] Received ${uniqueResponses.size} unique responses from ${modelsToTest.length} models`);

      // At least 2 different responses expected
      expect(uniqueResponses.size).toBeGreaterThanOrEqual(2);
    }, 60000); // 60 second timeout for multiple API calls
  });

  describe("API Translation", () => {
    test("should correctly translate Anthropic request to OpenRouter format", async () => {
      const port = 3400;
      const proxy = await startTestProxy("x-ai/grok-code-fast-1", port);

      // Send request with system message
      const request: AnthropicRequest = {
        model: "claude-sonnet-4.5",
        system: "You are a helpful assistant.",
        messages: [
          {
            role: "user",
            content: "Say 'test successful' and nothing else",
          },
        ],
        max_tokens: 50,
        temperature: 0.5,
        stream: false,
      };

      const response = await fetch(`${proxy.url}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.ok).toBe(true);

      const data = (await response.json()) as AnthropicResponse;

      // Verify response structure
      expect(data.type).toBe("message");
      expect(data.role).toBe("assistant");
      expect(data.content).toBeDefined();
      expect(data.usage).toBeDefined();
      expect(data.usage.input_tokens).toBeGreaterThan(0);
      expect(data.usage.output_tokens).toBeGreaterThan(0);

      console.log(`\n[TRANSLATION TEST] Response: ${data.content[0].text}`);
    }, 30000);
  });
});
