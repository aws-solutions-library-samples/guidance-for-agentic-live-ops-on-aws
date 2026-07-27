# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Agent Factory Module

Reads AgentConfig records from DynamoDB and dynamically creates @tool functions
at runtime, replacing the hardcoded agent blocks in index.py. Each generated tool
follows the same pattern: load prompt → resolve model → resolve tools → create
Agent → emit reasoning events → return result.
"""

import os
import time
import math
import json
import boto3
from datetime import datetime
from aws_lambda_powertools import Logger
from strands import Agent, tool
from strands.models import BedrockModel
from common.reasoning_emitter import emit_agent, emit_error
from common.schema_context import enrich_subagent_query
from tools.athena_query import create_athena_tools
from tools.realtime_monitor import create_realtime_tools
from tools.schema_search import create_schema_tools
from tools.schema_graph import create_graph_tools
from tools.entity_resolution import create_entity_resolution_tools

logger = Logger(service="agent-factory", level=os.getenv("LOG_LEVEL", "DEBUG"))

# Map tool_set names to their creator functions
TOOL_SET_REGISTRY = {
    "athena": create_athena_tools,
    "realtime": create_realtime_tools,
    "schema": create_schema_tools,
    "graph": create_graph_tools,
    "entity_resolution": create_entity_resolution_tools,
}

# Domain label for {{domain}} placeholder substitution
DOMAIN_LABEL = os.getenv("DOMAIN_LABEL", "generic")

# Domain context prefix (matches index.py pattern)
DOMAIN_CONTEXT = f"""
Domain context: {DOMAIN_LABEL}. Analyze data and provide insights relevant to this domain.
"""

# Model configuration (mirrors index.py resolution logic)
_model_config_raw = os.getenv("MODEL_CONFIG", "{}")
try:
    _model_config = json.loads(_model_config_raw)
except json.JSONDecodeError:
    logger.warning("Failed to parse MODEL_CONFIG JSON, using defaults")
    _model_config = {}

DEFAULT_MODEL_ID = _model_config.get(
    "defaultModelId",
    os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0"),
)
AGENT_MODELS: dict = _model_config.get("agents", {})
AWS_REGION = os.getenv("BEDROCK_REGION", "us-west-2")

# DynamoDB cache TTL for agent configs (30 minutes)
DYNAMO_CACHE_TTL_SECONDS = int(os.getenv("AGENT_CONFIG_DYNAMO_TTL", "1800"))


def _compute_expires_at() -> int:
    """Return a Unix epoch timestamp DYNAMO_CACHE_TTL_SECONDS from now."""
    return math.floor(time.time()) + DYNAMO_CACHE_TTL_SECONDS


def get_model_id_for_agent(agent_name: str = None) -> str:
    """Resolve the model ID for a specific agent from MODEL_CONFIG."""
    return (
        AGENT_MODELS.get(agent_name, DEFAULT_MODEL_ID)
        if agent_name
        else DEFAULT_MODEL_ID
    )


def get_bedrock_model(agent_name: str = None):
    """Create a new Bedrock model instance for a specific agent.

    Resolves model ID from MODEL_CONFIG JSON:
    agents.<agent_name> → defaultModelId → BEDROCK_MODEL_ID fallback.
    """
    model_id = get_model_id_for_agent(agent_name)
    return BedrockModel(
        model_id=model_id,
        region_name=AWS_REGION,
        temperature=0.3,
    )


def resolve_tools(tool_sets: list) -> list:
    """Resolve tool_sets entries to actual tool functions via TOOL_SET_REGISTRY.

    Skips unrecognized tool_set names with a warning.
    """
    tools = []
    for tool_set_name in tool_sets:
        creator = TOOL_SET_REGISTRY.get(tool_set_name)
        if creator:
            tools.extend(creator())
        else:
            logger.warning(
                f"Unrecognized tool_set '{tool_set_name}', skipping",
                extra={"tool_set": tool_set_name},
            )
    return tools


def substitute_domain(prompt_template: str) -> str:
    """Replace {{domain}} placeholders in prompt_template with DOMAIN_LABEL."""
    return prompt_template.replace("{{domain}}", DOMAIN_LABEL)


class AgentFactory:
    """Discovers agent configs from S3 and creates @tool functions.

    S3 is the source of truth. Each agent is a folder under the `agents/` prefix:
        agents/{agent_id}/config.json   — metadata (display_name, description, tool_sets, etc.)
        agents/{agent_id}/prompt.md     — system prompt markdown

    DynamoDB is used as a cache layer with 30-min TTL. The refresh cycle:
    1. Check DynamoDB cache (fast path)
    2. If cache expired → scan S3 for all agent folders
    3. Write discovered configs to DynamoDB with TTL
    4. Build @tool functions from the configs
    """

    def __init__(
        self,
        table_name: str | None,
        bucket_name: str | None = None,
        cache_ttl: int = 300,
        default_configs: list[dict] | None = None,
    ):
        self._table_name = table_name
        self._bucket_name = bucket_name
        self._cache_ttl = cache_ttl
        self._default_configs = default_configs or []
        self._registry: list[callable] = []
        self._last_refresh: float = 0

        if not self._table_name:
            logger.warning(
                "AGENT_CONFIG_TABLE not set — agent factory disabled, "
                "orchestrator will run with shared tools only"
            )

    def get_agent_tools(self) -> list[callable]:
        """Return cached agent tools, refreshing if TTL expired."""
        if not self._table_name:
            return []

        now = time.time()
        if now - self._last_refresh > self._cache_ttl:
            self._refresh()

        return list(self._registry)

    def _refresh(self) -> None:
        """Scan S3 for agent configs, cache in DynamoDB, and rebuild registry.

        1. Try DynamoDB first (fast path — items may still be cached)
        2. If DynamoDB is empty or all items expired → scan S3 for agent folders
        3. Write S3-discovered configs to DynamoDB with TTL
        4. Build @tool functions from the configs
        """
        try:
            dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
            table = dynamodb.Table(self._table_name)

            # Fast path: check DynamoDB cache
            response = table.scan()
            items = response.get("Items", [])
            while "LastEvaluatedKey" in response:
                response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
                items.extend(response.get("Items", []))

            # If DynamoDB is empty, discover agents from S3
            if not items:
                s3_configs = self._discover_from_s3()
                if s3_configs:
                    items = self._write_configs_to_dynamo(table, s3_configs)
                elif self._default_configs:
                    logger.info("No S3 configs found, using defaults")
                    items = self._write_configs_to_dynamo(table, self._default_configs)

            # Build new registry from enabled configs only
            new_registry = []
            for config in items:
                if not config.get("enabled", False):
                    continue
                try:
                    agent_tool = self._create_agent_tool(config)
                    new_registry.append(agent_tool)
                except Exception as e:
                    logger.warning(
                        f"Failed to create tool for agent '{config.get('agent_id', 'unknown')}': {e}",
                        extra={"config": config, "error": str(e)},
                    )

            self._registry = new_registry
            self._last_refresh = time.time()

            logger.info(
                f"Agent registry refreshed: {len(self._registry)} agents loaded",
                extra={
                    "agent_count": len(self._registry),
                    "agent_ids": [
                        getattr(t, "__name__", "unknown") for t in self._registry
                    ],
                },
            )

        except Exception as e:
            if self._registry:
                logger.warning(
                    f"Failed to refresh agent registry: {e}. Keeping previous registry.",
                    extra={"error": str(e)},
                )
            elif self._default_configs:
                logger.warning(
                    f"Failed to refresh: {e}. Falling back to defaults in-memory.",
                    extra={"error": str(e)},
                )
                new_registry = []
                for config in self._default_configs:
                    if not config.get("enabled", True):
                        continue
                    try:
                        new_registry.append(self._create_agent_tool(config))
                    except Exception as inner_e:
                        logger.warning(f"Failed to create default tool: {inner_e}")
                self._registry = new_registry
                self._last_refresh = time.time()
            else:
                logger.warning(
                    f"Failed to refresh agent registry: {e}. No fallback available.",
                    extra={"error": str(e)},
                )

    def _discover_from_s3(self) -> list[dict]:
        """Scan S3 bucket for agent folders and return config dicts.

        Convention: agents/{agent_id}/config.json + agents/{agent_id}/prompt.md
        """
        if not self._bucket_name:
            return []

        try:
            s3 = boto3.client("s3", region_name=AWS_REGION)
            prefix = "agents/"

            # List all objects under agents/
            paginator = s3.get_paginator("list_objects_v2")
            all_keys = []
            for page in paginator.paginate(Bucket=self._bucket_name, Prefix=prefix):
                for obj in page.get("Contents", []):
                    all_keys.append(obj["Key"])

            # Group by agent_id (folder name)
            agent_folders: dict[str, dict[str, str]] = {}
            for key in all_keys:
                # agents/performance_metrics/config.json → agent_id=performance_metrics
                parts = key.removeprefix(prefix).split("/")
                if len(parts) == 2 and parts[0] and parts[1]:
                    agent_id = parts[0]
                    filename = parts[1]
                    if agent_id not in agent_folders:
                        agent_folders[agent_id] = {}
                    agent_folders[agent_id][filename] = key

            configs = []
            for agent_id, files in agent_folders.items():
                config_key = files.get("config.json")
                prompt_key = files.get("prompt.md")

                if not config_key:
                    logger.warning(f"Agent '{agent_id}' missing config.json, skipping")
                    continue

                # Read config.json
                config_obj = s3.get_object(Bucket=self._bucket_name, Key=config_key)
                config = json.loads(config_obj["Body"].read().decode("utf-8"))
                config["agent_id"] = agent_id  # ensure agent_id matches folder name

                # Read prompt.md if present
                if prompt_key:
                    prompt_obj = s3.get_object(Bucket=self._bucket_name, Key=prompt_key)
                    config["prompt_template"] = (
                        prompt_obj["Body"].read().decode("utf-8").strip()
                    )

                config.setdefault("enabled", True)
                config.setdefault("source", "s3")
                configs.append(config)

            logger.info(
                f"Discovered {len(configs)} agent configs from S3",
                extra={
                    "bucket": self._bucket_name,
                    "agent_ids": [c["agent_id"] for c in configs],
                },
            )
            return configs

        except Exception as e:
            logger.warning(f"Failed to discover agents from S3: {e}")
            return []

    def _write_configs_to_dynamo(self, table, configs: list[dict]) -> list[dict]:
        """Write configs to DynamoDB with TTL. Returns the written items."""
        now = datetime.utcnow().isoformat() + "Z"
        expires_at = _compute_expires_at()
        written = []

        with table.batch_writer() as batch:
            for cfg in configs:
                item = {
                    "agent_id": cfg["agent_id"],
                    "display_name": cfg.get("display_name", ""),
                    "description": cfg.get("description", ""),
                    "agent_type": cfg.get("agent_type", ""),
                    "prompt_template": cfg.get("prompt_template", ""),
                    "model_key": cfg.get("model_key", ""),
                    "tool_sets": cfg.get("tool_sets", []),
                    "enabled": cfg.get("enabled", True),
                    "created_at": now,
                    "updated_at": now,
                    "expires_at": expires_at,
                    "source": cfg.get("source", "s3"),
                }
                batch.put_item(Item=item)
                written.append(item)

        logger.info(
            f"Wrote {len(written)} agent configs to DynamoDB cache "
            f"(expires_at={expires_at})"
        )
        return written

    def _create_agent_tool(self, config: dict) -> callable:
        """Create a single @tool function from an AgentConfig record.

        The generated function replicates the exact behavior of the hardcoded
        agents in index.py: emit invocation → create Agent → emit completion.
        """
        agent_id = config["agent_id"]
        display_name = config.get("display_name", agent_id.replace("_", " ").title())
        description = config.get("description", f"{display_name} agent")
        prompt_template = config.get("prompt_template", "")
        model_key = config.get("model_key", "")
        tool_sets = config.get("tool_sets", [])
        agent_type = config.get("agent_type", "dynamic")

        # Build the docstring from display_name and description
        docstring = f"{display_name} - {description}"

        def agent_tool_fn(query: str) -> str:
            try:
                agent_start_time = time.time()

                # Resolve model: use model_key if provided, else agent_id, else default
                effective_model_key = model_key if model_key else agent_id
                model_id = get_model_id_for_agent(effective_model_key)

                logger.info(
                    f"🎯 {display_name.upper()} CALLED!",
                    {
                        "query": query,
                        "agent_name": display_name,
                        "agent_id": agent_id,
                        "call_timestamp": agent_start_time,
                    },
                )

                # Emit agent invocation event (for animated line)
                emit_agent(
                    agent_name=display_name,
                    query=query,
                    result="",  # Empty result indicates agent is being called
                    metadata={
                        "agent_type": agent_type,
                        "status": "invoking",
                        "model_id": model_id,
                    },
                )

                logger.info(
                    f"Initializing {display_name}",
                    extra={
                        "query": query,
                        "conversation_direction": f"orchestrator_to_{agent_id}_agent",
                        "agent_type": agent_type,
                        "agent_invocation_timestamp": time.time(),
                    },
                )

                # Substitute {{domain}} in prompt_template
                system_prompt = substitute_domain(prompt_template)

                # Prepend domain context if prompt is available
                if system_prompt:
                    system_prompt = f"{DOMAIN_CONTEXT}\n\n{system_prompt}"
                else:
                    # Fallback: generate a basic prompt
                    system_prompt = (
                        f"{DOMAIN_CONTEXT}\n\n"
                        f"{display_name}. Provide analytics insights."
                    )

                # Resolve tools from tool_sets
                agent_tools = resolve_tools(tool_sets)

                # Create Strands Agent
                agent = Agent(
                    model=get_bedrock_model(effective_model_key),
                    system_prompt=system_prompt,
                    tools=agent_tools,
                )

                result = str(agent(enrich_subagent_query(query)))

                logger.info(
                    f"{display_name} completed successfully",
                    extra={
                        "query": query,
                        "result": result,
                        "conversation_direction": f"{agent_id}_agent_to_orchestrator",
                        "agent_type": agent_type,
                        "result_length": len(result),
                        "agent_completion_timestamp": time.time(),
                    },
                )

                # Emit agent completion event (for solid line)
                agent_duration = time.time() - agent_start_time
                emit_agent(
                    agent_name=display_name,
                    query=query,
                    result=result,
                    metadata={
                        "agent_type": agent_type,
                        "status": "completed",
                        "duration_ms": round(agent_duration * 1000, 2),
                        "model_id": model_id,
                    },
                )
                return result

            except Exception as e:
                logger.error(
                    f"{display_name} failed",
                    extra={"error": str(e), "query": query},
                )
                emit_error(
                    f"{display_name} encountered an error: {e}",
                    error_type="agent_error",
                    metadata={
                        "agent_name": display_name,
                        "error_details": str(e),
                    },
                )
                return f"{display_name} Error: {e}"

        # Apply @tool decorator behavior: set __name__ and __doc__ so Strands
        # registers the function correctly with the right name and docstring
        agent_tool_fn.__name__ = agent_id
        agent_tool_fn.__doc__ = docstring

        # Apply the @tool decorator
        decorated = tool(agent_tool_fn)

        return decorated
