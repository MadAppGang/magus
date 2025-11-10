import type { OpenRouterModel } from "./types.js";

export const DEFAULT_MODEL: OpenRouterModel = "x-ai/grok-code-fast-1";
export const DEFAULT_PORT_RANGE = { start: 3000, end: 9000 };

// Model metadata for validation and display
export const MODEL_INFO: Record<
  OpenRouterModel,
  { name: string; description: string; priority: number; provider: string }
> = {
  "x-ai/grok-code-fast-1": {
    name: "Grok Code Fast",
    description: "xAI's fast coding model",
    priority: 1,
    provider: "xAI",
  },
  "openai/gpt-5-codex": {
    name: "GPT-5 Codex",
    description: "OpenAI's advanced coding model",
    priority: 2,
    provider: "OpenAI",
  },
  "minimax/minimax-m2": {
    name: "MiniMax M2",
    description: "MiniMax's high-performance model",
    priority: 3,
    provider: "MiniMax",
  },
  "z-ai/glm-4.6": {
    name: "GLM-4.6",
    description: "Advanced language model",
    priority: 4,
    provider: "Zhipu AI",
  },
  "qwen/qwen3-vl-235b-a22b-instruct": {
    name: "Qwen3 VL 235B",
    description: "Alibaba's vision-language model",
    priority: 5,
    provider: "Alibaba",
  },
  "anthropic/claude-sonnet-4.5": {
    name: "Claude Sonnet 4.5",
    description: "Anthropic's Claude (for comparison)",
    priority: 6,
    provider: "Anthropic",
  },
  custom: {
    name: "Custom Model",
    description: "Enter any OpenRouter model ID manually",
    priority: 999,
    provider: "Custom",
  },
};

// Environment variable names
export const ENV = {
  OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
  CLAUDISH_MODEL: "CLAUDISH_MODEL",
  CLAUDISH_PORT: "CLAUDISH_PORT",
} as const;

// OpenRouter API Configuration
export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://github.com/MadAppGang/claude-code",
  "X-Title": "Claudish - OpenRouter Proxy",
} as const;
