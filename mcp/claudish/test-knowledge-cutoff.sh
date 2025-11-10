#!/bin/bash

# Test knowledge cutoff differences between MiniMax and GPT-4o
# GPT-4o cutoff: October 2023
# MiniMax cutoff: June 2025

echo "=== KNOWLEDGE CUTOFF TEST ==="
echo ""
echo "Testing 3 events that happened AFTER GPT-4o's cutoff (Oct 2023)"
echo "but BEFORE MiniMax's cutoff (June 2025)"
echo ""

# Load environment
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Question 1: GPT-4o release (May 2024)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Q1: When was GPT-4o released? Give exact month and year only."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "[MiniMax M2 Response]"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d '{
    "model": "minimax/minimax-m2",
    "messages": [{"role": "user", "content": "When was GPT-4o released? Give exact month and year only."}],
    "temperature": 0.1,
    "max_tokens": 50
  }' | jq -r '.choices[0].message.content // .choices[0].message.reasoning // "ERROR"'

echo ""
echo "[GPT-4o Response]"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "When was GPT-4o released? Give exact month and year only."}],
    "temperature": 0.1,
    "max_tokens": 50
  }' | jq -r '.choices[0].message.content // "ERROR"'

echo ""
echo "Expected: MiniMax='May 2024', GPT-4o='I don't know' or speculation"
echo ""

# Question 2: Claude 3.5 Sonnet (June 2024)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Q2: What month and year was Claude 3.5 Sonnet released?"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "[MiniMax M2 Response]"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d '{
    "model": "minimax/minimax-m2",
    "messages": [{"role": "user", "content": "What month and year was Claude 3.5 Sonnet released?"}],
    "temperature": 0.1,
    "max_tokens": 50
  }' | jq -r '.choices[0].message.content // .choices[0].message.reasoning // "ERROR"'

echo ""
echo "[GPT-4o Response]"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "What month and year was Claude 3.5 Sonnet released?"}],
    "temperature": 0.1,
    "max_tokens": 50
  }' | jq -r '.choices[0].message.content // "ERROR"'

echo ""
echo "Expected: MiniMax='June 2024', GPT-4o='I don't know' or speculation"
echo ""

# Question 3: Claude 4 (May-June 2025)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Q3: Has Claude 4 been released yet? If yes, when?"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "[MiniMax M2 Response]"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d '{
    "model": "minimax/minimax-m2",
    "messages": [{"role": "user", "content": "Has Claude 4 been released yet? If yes, when?"}],
    "temperature": 0.1,
    "max_tokens": 100
  }' | jq -r '.choices[0].message.content // .choices[0].message.reasoning // "ERROR"'

echo ""
echo "[GPT-4o Response]"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Has Claude 4 been released yet? If yes, when?"}],
    "temperature": 0.1,
    "max_tokens": 100
  }' | jq -r '.choices[0].message.content // "ERROR"'

echo ""
echo "Expected: MiniMax='Yes, May-June 2025', GPT-4o='No' or speculation"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "If MiniMax knows about May 2024+ events but GPT-4o doesn't,"
echo "then we have DEFINITIVE PROOF they are different models!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
