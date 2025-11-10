#!/bin/bash

echo "=== CHINESE QUESTION COMPARISON ==="
echo "Question: 请用中文回答：你是什么AI模型？你的开发公司是谁？只用一句话回答。"
echo ""

echo "MiniMax-M2 Response:"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "minimax/minimax-m2",
    "messages": [{"role": "user", "content": "请用中文回答：你是什么AI模型？你的开发公司是谁？只用一句话回答。"}],
    "temperature": 0.3,
    "max_tokens": 500
  }' | jq -r '.choices[0].message.content'

echo ""
echo "GPT-4o Response:"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "请用中文回答：你是什么AI模型？你的开发公司是谁？只用一句话回答。"}],
    "temperature": 0.3,
    "max_tokens": 500
  }' | jq -r '.choices[0].message.content'

echo ""
echo "=== ENGLISH QUESTION COMPARISON ==="
echo "Question: In one sentence: What do you know about MiniMax AI company and when were you trained?"
echo ""

echo "MiniMax-M2 Response:"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "minimax/minimax-m2",
    "messages": [{"role": "user", "content": "In one sentence: What do you know about MiniMax AI company and when were you trained?"}],
    "temperature": 0.3,
    "max_tokens": 500
  }' | jq -r '.choices[0].message.content'

echo ""
echo "GPT-4o Response:"
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "In one sentence: What do you know about MiniMax AI company and when were you trained?"}],
    "temperature": 0.3,
    "max_tokens": 500
  }' | jq -r '.choices[0].message.content'
