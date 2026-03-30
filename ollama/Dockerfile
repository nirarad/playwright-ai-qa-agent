FROM ollama/ollama:latest

# Default model to pull on first start (override with -e or docker-compose env)
ENV OLLAMA_PULL_MODEL=qwen2.5:7b

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 11434

# CPU / GPU are applied at run time: see ollama/docker-compose.yml (deploy.resources)
# or: docker run --gpus all --cpus=8 ...

ENTRYPOINT ["/entrypoint.sh"]
