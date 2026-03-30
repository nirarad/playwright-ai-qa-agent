#!/bin/sh
set -eu

ollama serve &
OLLAMA_PID=$!

MODEL="${OLLAMA_PULL_MODEL:-}"
if [ -n "$MODEL" ]; then
  echo "Pulling Ollama model: $MODEL"
  # Wait until Ollama API is reachable before pull.
  until ollama list >/dev/null 2>&1; do
    sleep 1
  done
  ollama pull "$MODEL"
fi

wait "$OLLAMA_PID"
