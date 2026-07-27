FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app

COPY requirements.txt requirements.txt
# Install from requirements file
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir aws-opentelemetry-distro>=0.10.1

# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1

# Disable Python output buffering for real-time streaming
ENV PYTHONUNBUFFERED=1

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
EXPOSE 8000

# Copy entire project (respecting .dockerignore)
COPY . .

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ping || exit 1

# Use the full module path

CMD ["opentelemetry-instrument", "python", "-m", "index"]
