// AUTO-GENERATED from shared/recommended-models.md
// DO NOT EDIT MANUALLY - Run 'bun run extract-models' to regenerate

import type { OpenRouterModel } from "./types.js";

export const DEFAULT_MODEL: OpenRouterModel = "x-ai/grok-code-fast-1";
export const DEFAULT_PORT_RANGE = { start: 3000, end: 9000 };

// Model metadata for validation and display
export const MODEL_INFO: Record<
  OpenRouterModel,
  { name: string; description: string; priority: number; provider: string }
> = {
  "x-ai/grok-code-fast-1": {
    name: "Ultra-fast coding",
    description: "Ultra-fast coding",
    priority: 1,
    provider: "xAI",
  },
  "google/gemini-2.5-flash": {
    name: "Advanced reasoning with built-in thinking",
    description: "Advanced reasoning with built-in thinking",
    priority: 2,
    provider: "Google",
  },
  "qwen/qwen3-235b-a22b-2507": {
    name: "Large-scale reasoning",
    description: "Large-scale reasoning",
    priority: 3,
    provider: "Alibaba",
  },
  "minimax/minimax-m2": {
    name: "Compact high-efficiency",
    description: "Compact high-efficiency",
    priority: 4,
    provider: "MiniMax",
  },
  "z-ai/glm-4.6": {
    name: "Ultra-budget balanced pricing",
    description: "Ultra-budget balanced pricing",
    priority: 5,
    provider: "Zhipu AI",
  },
  "openai/gpt-4o-mini": {
    name: "Compact multimodal",
    description: "Compact multimodal",
    priority: 6,
    provider: "OpenAI",
  },
  "tngtech/deepseek-r1t2-chimera:free": {
    name: "Free reasoning model",
    description: "Free reasoning model",
    priority: 7,
    provider: "TNG Tech",
  },
  "openrouter/polaris-alpha": {
    name: "OpenRouter ultra-budget",
    description: "OpenRouter ultra-budget",
    priority: 8,
    provider: "OpenRouter",
  },
  "custom": {
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
  CLAUDISH_ACTIVE_MODEL_NAME: "CLAUDISH_ACTIVE_MODEL_NAME", // Set by claudish to show active model in status line
  ANTHROPIC_MODEL: "ANTHROPIC_MODEL", // Claude Code standard env var for model selection
  ANTHROPIC_SMALL_FAST_MODEL: "ANTHROPIC_SMALL_FAST_MODEL", // Claude Code standard env var for fast model
} as const;

// OpenRouter API Configuration
export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://github.com/MadAppGang/claude-code",
  "X-Title": "Claudish - OpenRouter Proxy",
} as const;
