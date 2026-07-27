# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Memory Tools

Provides memory management for AgentCore conversations:
- Lazy memory ID resolution (from name or direct env var)
- Session manager singleton
- @tool functions for conversation history retrieval and long-term memory search

Usage:
    from tools.memory import (
        create_memory_tools,
        get_memory_session_manager,
        MEMORY_ID,
        MEMORY_NAME,
    )
"""

import os
import time
import logging
import boto3
from strands import tool
from bedrock_agentcore.memory.session import MemorySessionManager
from bedrock_agentcore.memory.constants import MessageRole

logger = logging.getLogger(__name__)

AWS_REGION = os.getenv("BEDROCK_REGION", "us-west-2")

MEMORY_NAME = os.getenv(
    "BEDROCK_MEMORY_NAME"
)  # Memory name — used to look up ID at startup
MEMORY_ID = os.getenv(
    "BEDROCK_MEMORY_ID"
)  # Memory ID — resolved from name if not set directly


def _resolve_memory_id() -> str | None:
    """Resolve memory ID from name via AgentCore control plane API."""
    if MEMORY_ID:
        return MEMORY_ID
    if not MEMORY_NAME:
        return None
    try:
        client = boto3.client("bedrock-agentcore-control", region_name=AWS_REGION)
        response = client.list_memories()
        for mem in response.get("memories", []):
            mem_id = mem.get("id", "")
            # Match by name field if present, or by ID prefix (AgentCore
            # appends a unique suffix like "MemoryName-xYz123" to the ID).
            if mem.get("name") == MEMORY_NAME or mem_id.startswith(MEMORY_NAME):
                logger.info(
                    "Resolved memory ID: %s (from name: %s)", mem_id, MEMORY_NAME
                )
                return mem_id
        logger.warning(
            "Memory not found by name: %s (available: %s)",
            MEMORY_NAME,
            [m.get("id") for m in response.get("memories", [])],
        )
    except Exception as e:
        logger.warning("Failed to resolve memory ID by name: %s", e)
    return None


########################
# Lazy Memory Initialization
########################
# Resolved on first request to avoid blocking startup

_resolved_memory_id: str | None = None
_memory_session_manager: "MemorySessionManager | None" = None
_memory_initialized = False


def get_memory_session_manager():
    """Lazily resolve memory ID and create session manager on first call."""
    global _resolved_memory_id, _memory_session_manager, _memory_initialized
    if not _memory_initialized:
        _memory_initialized = True
        _resolved_memory_id = _resolve_memory_id()
        if _resolved_memory_id:
            _memory_session_manager = MemorySessionManager(
                memory_id=_resolved_memory_id, region_name=AWS_REGION
            )
    return _memory_session_manager


def create_memory_tools():
    """
    Create memory tools that use the CDK-provided memory ID.

    Each actor gets their own session within the shared memory space.
    """

    @tool
    def get_conversation_history(
        actor_id: str, session_id: str, max_results: int = 10
    ) -> str:
        """Retrieve conversation history from AgentCore Memory for this user's session."""
        try:
            if not get_memory_session_manager():
                return "📝 Memory not available - no previous conversation history."

            logger.info(
                "Retrieving conversation history from memory",
                extra={
                    "actor_id": actor_id,
                    "session_id": session_id,
                    "max_results": max_results,
                    "memory_id": MEMORY_ID,
                    "retrieval_timestamp": time.time(),
                },
            )

            session = get_memory_session_manager().create_memory_session(
                actor_id=actor_id, session_id=session_id
            )

            turns = session.get_last_k_turns(k=max_results)

            logger.info(
                "🔍 MEMORY TOOL - RAW TURNS OUTPUT",
                extra={
                    "turns_type": type(turns).__name__,
                    "turns_length": len(turns) if turns else 0,
                    "turns_content": str(turns)[:500] if turns else "None",
                    "first_turn_type": type(turns[0]).__name__
                    if turns and len(turns) > 0
                    else "N/A",
                    "first_turn_has_messages": hasattr(turns[0], "messages")
                    if turns and len(turns) > 0
                    else False,
                    "first_turn_str": str(turns[0])[:200]
                    if turns and len(turns) > 0
                    else "N/A",
                },
            )

            if not turns:
                return "📝 No previous conversation history found for this session."

            history = "📝 **Conversation History:**\n\n"

            for turn in turns:
                if hasattr(turn, "messages"):
                    messages = turn.messages
                elif isinstance(turn, dict):
                    messages = turn.get("messages", [])
                else:
                    messages = turn if isinstance(turn, list) else []

                for message in messages:
                    if hasattr(message, "role"):
                        role = message.role
                        content = (
                            message.content.text
                            if hasattr(message.content, "text")
                            else str(message.content)
                        )
                    else:
                        role = message.get("role", "UNKNOWN")
                        content = (
                            message.get("content", {}).get("text", "")
                            if isinstance(message.get("content"), dict)
                            else str(message.get("content", ""))
                        )

                    role_str = role.value if hasattr(role, "value") else str(role)

                    if (
                        role_str == MessageRole.ASSISTANT.value
                        or role_str == "ASSISTANT"
                    ):
                        history += f"**Assistant:** {content}\n\n"
                    elif role_str == MessageRole.USER.value or role_str == "USER":
                        history += f"**User:** {content}\n\n"
                    else:
                        history += f"**{role_str}:** {content}\n\n"

            logger.info(
                "Conversation history retrieved successfully",
                extra={
                    "actor_id": actor_id,
                    "session_id": session_id,
                    "turns_count": len(turns),
                    "history_length": len(history),
                    "retrieval_success": True,
                    "retrieval_complete_timestamp": time.time(),
                },
            )
            return history

        except Exception as e:
            logger.error(
                "Failed to retrieve conversation history", extra={"error": str(e)}
            )
            return f"❌ Failed to retrieve conversation history: {e}"

    @tool
    def search_long_term_memory(
        actor_id: str, session_id: str, query: str, max_results: int = 3
    ) -> str:
        """
        Search long-term memory for relevant information.

        Note: This requires memory strategies to be configured.
        Current setup uses short-term memory only.
        """
        try:
            if not get_memory_session_manager():
                return "📝 Long-term memory not available."

            logger.info(
                "Searching long-term memory",
                extra={
                    "actor_id": actor_id,
                    "session_id": session_id,
                    "query": query,
                    "max_results": max_results,
                    "memory_id": MEMORY_ID,
                },
            )

            session = get_memory_session_manager().create_memory_session(
                actor_id=actor_id, session_id=session_id
            )

            memory_records = session.search_long_term_memories(
                query=query, namespace_prefix="/", top_k=max_results
            )

            if not memory_records:
                return "📝 No relevant information found in long-term memory."

            results = "🧠 **Long-term Memory Search Results:**\n\n"

            for i, record in enumerate(memory_records, 1):
                content = record.get("content", "No content available")
                score = record.get("score", 0)
                results += f"**Result {i}** (relevance: {score:.2f}):\n{content}\n\n"

            logger.info(
                "Long-term memory search completed",
                extra={
                    "actor_id": actor_id,
                    "session_id": session_id,
                    "query": query,
                    "results_count": len(memory_records),
                    "search_success": True,
                },
            )
            return results

        except Exception as e:
            logger.error("Failed to search long-term memory", extra={"error": str(e)})
            return f"❌ Failed to search long-term memory: {e}"

    return [get_conversation_history, search_long_term_memory]
