# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Reasoning Event Emitter for Agentic Live Ops System

This module provides utilities to emit reasoning events that can be captured
by the frontend to show the AI's thinking process in real-time.
"""

import json
import time
from typing import Optional, Dict, Any, List
from aws_lambda_powertools import Logger

logger = Logger(service="reasoning-emitter")


class ReasoningEmitter:
    """Emits reasoning events for the AI agent's thinking process."""

    def __init__(self, request_id: str = None):
        self.request_id = request_id or f"reasoning-{int(time.time())}"
        self.step_counter = 0
        self.events = []  # Store events for later retrieval

    def emit_reasoning(
        self,
        reasoning_type: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """
        Emit a reasoning event.

        Args:
            reasoning_type: Type of reasoning (thinking, analysis, decision, complete)
            content: The reasoning content to display
            metadata: Additional metadata for the reasoning step
        """
        self.step_counter += 1

        reasoning_event = {
            "event_type": "reasoning",
            "reasoning_type": reasoning_type,
            "content": content,
            "timestamp": time.time(),
            "request_id": self.request_id,
            "step": self.step_counter,
            "metadata": metadata or {},
        }

        # Store the event for later retrieval (backward compatibility)
        self.events.append(reasoning_event)

        # Log the reasoning event for debugging
        logger.info(
            "Reasoning event emitted",
            extra={
                "reasoning_event": reasoning_event,
                "conversation_direction": "agent_reasoning_to_frontend",
            },
        )

        # Emit real-time SSE event to stdout for AgentCore streaming
        self._emit_sse_event(reasoning_event)

    def _emit_sse_event(self, event_data: Dict[str, Any]):
        """
        Emit a Server-Sent Event to stdout for real-time streaming.

        Args:
            event_data: The event data to emit as SSE
        """
        try:
            # Format as SSE event
            sse_data = json.dumps(event_data)

            logger.info(
                "📡 SSE EVENT EMITTED",
                {
                    "event_type": event_data.get("event_type"),
                    "reasoning_type": event_data.get("reasoning_type"),
                    "content_length": len(event_data.get("content", ""))
                    if event_data.get("content")
                    else 0,
                    "metadata": event_data.get("metadata", {}),
                    "sse_data_length": len(sse_data),
                },
            )

            # Output SSE format that AgentCore can stream
            print(f"data: {sse_data}\n", flush=True)

            # Also emit with event type for better parsing
            if event_data.get("reasoning_type"):
                print(f"event: {event_data['reasoning_type']}\n", flush=True)

        except Exception as e:
            logger.error(
                f"Failed to emit SSE event: {e}", extra={"event_data": event_data}
            )

    def thinking(self, content: str, metadata: Optional[Dict[str, Any]] = None):
        """Emit a thinking reasoning event."""
        self.emit_reasoning("thinking", content, metadata)

    def analysis(self, content: str, metadata: Optional[Dict[str, Any]] = None):
        """Emit an analysis reasoning event."""
        self.emit_reasoning("analysis", content, metadata)

    def decision(self, content: str, metadata: Optional[Dict[str, Any]] = None):
        """Emit a decision reasoning event."""
        self.emit_reasoning("decision", content, metadata)

    def complete(self, content: str, metadata: Optional[Dict[str, Any]] = None):
        """Emit a completion reasoning event."""
        self.emit_reasoning("complete", content, metadata)

    def agent(
        self,
        agent_name: str,
        query: str,
        result: str,
        status: str = "completed",
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Emit an agent reasoning event with query and result."""
        agent_id = f"agent-{agent_name.lower().replace(' ', '-')}"
        agent_metadata = metadata or {}
        agent_metadata.update(
            {
                "id": agent_id,
                "agent_name": agent_name,
                "agent_query": query,
                "agent_result": result,
                "status": status,
            }
        )
        self.emit_reasoning("agent", result, agent_metadata)

    def error(
        self,
        content: str,
        error_type: str = "general",
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Emit an error reasoning event."""
        error_metadata = metadata or {}
        error_metadata.update({"error_type": error_type, "is_error": True})
        self.emit_reasoning("error", content, error_metadata)

    def emit_content(self, content: str, metadata: Optional[Dict[str, Any]] = None):
        """
        Emit a content event for streaming partial results.

        Args:
            content: The content to stream
            metadata: Additional metadata for the content
        """
        content_event = {
            "event_type": "content",
            "content": content,
            "timestamp": time.time(),
            "request_id": self.request_id,
            "metadata": metadata or {},
        }

        # Log the content event
        logger.info(
            "Content event emitted",
            extra={
                "content_event": content_event,
                "conversation_direction": "agent_content_to_frontend",
            },
        )

        # Emit real-time SSE event
        self._emit_sse_event(content_event)

    def emit_session_id(self, session_id: str):
        """
        Emit session ID event for frontend tracking.

        Args:
            session_id: The session ID to emit
        """
        session_event = {
            "event_type": "session_id",
            "session_id": session_id,
            "timestamp": time.time(),
            "request_id": self.request_id,
        }

        # Emit real-time SSE event
        self._emit_sse_event(session_event)

    def get_events(self) -> List[Dict[str, Any]]:
        """Get all collected reasoning events."""
        return self.events.copy()

    def clear_events(self):
        """Clear all collected reasoning events."""
        self.events.clear()
        self.step_counter = 0


# Global reasoning emitter instance
_global_emitter: Optional[ReasoningEmitter] = None


def initialize_reasoning(request_id: str = None) -> ReasoningEmitter:
    """Initialize global reasoning emitter."""
    global _global_emitter
    _global_emitter = ReasoningEmitter(request_id)
    return _global_emitter


def get_reasoning_emitter() -> Optional[ReasoningEmitter]:
    """Get the global reasoning emitter."""
    return _global_emitter


def emit_thinking(content: str, metadata: Optional[Dict[str, Any]] = None):
    """Convenience function to emit thinking event."""
    if _global_emitter:
        _global_emitter.thinking(content, metadata)


def emit_analysis(content: str, metadata: Optional[Dict[str, Any]] = None):
    """Convenience function to emit analysis event."""
    if _global_emitter:
        _global_emitter.analysis(content, metadata)


def emit_decision(content: str, metadata: Optional[Dict[str, Any]] = None):
    """Convenience function to emit decision event."""
    if _global_emitter:
        _global_emitter.decision(content, metadata)


def emit_complete(content: str, metadata: Optional[Dict[str, Any]] = None):
    """Convenience function to emit completion event."""
    if _global_emitter:
        _global_emitter.complete(content, metadata)


def emit_agent(
    agent_name: str,
    query: str,
    result: str,
    status: str = "completed",
    metadata: Optional[Dict[str, Any]] = None,
):
    """Convenience function to emit agent event with query and result."""
    logger.info(
        "🔥 EMIT_AGENT CALLED!",
        {
            "agent_name": agent_name,
            "query_length": len(query) if query else 0,
            "result_length": len(result) if result else 0,
            "metadata": metadata,
            "has_global_emitter": _global_emitter is not None,
        },
    )

    if _global_emitter:
        _global_emitter.agent(agent_name, query, result, status, metadata)
    else:
        logger.error(
            "❌ NO GLOBAL EMITTER - emit_agent called but no global emitter available"
        )


def emit_agent_invoking(
    agent_name: str, query: str, metadata: Optional[Dict[str, Any]] = None
):
    """
    Emit an agent invoking event before the sub-agent is called.

    Args:
        agent_name: Name of the agent being invoked
        query: The query being sent to the agent
        metadata: Additional metadata
    """
    if _global_emitter:
        agent_id = f"agent-{agent_name.lower().replace(' ', '-')}"
        meta = metadata or {}
        meta.update(
            {
                "id": agent_id,
                "agent_name": agent_name,
                "agent_query": query,
                "status": "invoking",
            }
        )
        _global_emitter.emit_reasoning("agent", f"Invoking {agent_name}...", meta)


def emit_error(
    content: str, error_type: str = "general", metadata: Optional[Dict[str, Any]] = None
):
    """Convenience function to emit error event."""
    if _global_emitter:
        _global_emitter.error(content, error_type, metadata)


def emit_memory(operation: str, status: str, metadata: Optional[Dict[str, Any]] = None):
    """
    Emit a memory event.

    Args:
        operation: Memory operation type (retrieve, save)
        status: Operation status (in_progress, success, error)
        metadata: Additional metadata for the memory operation
    """
    if _global_emitter:
        memory_metadata = metadata or {}
        memory_metadata.update(
            {
                "memory_operation": operation,
                "memory_status": status,
            }
        )

        # Create content based on operation and status
        if operation == "retrieve":
            if status == "in_progress":
                content = "Retrieving conversation history from memory..."
            elif status == "success":
                turns_count = memory_metadata.get("turns_count", 0)
                if turns_count > 0:
                    content = f"Retrieved {turns_count} conversation turns from memory"
                else:
                    content = "No previous conversation history found"
            else:
                content = f"Failed to retrieve memory: {memory_metadata.get('error', 'Unknown error')}"
        elif operation == "save":
            if status == "in_progress":
                content = "Saving conversation to memory..."
            elif status == "success":
                content = "Conversation saved to memory successfully"
            else:
                content = f"Failed to save to memory: {memory_metadata.get('error', 'Unknown error')}"
        else:
            content = f"Memory operation: {operation} - {status}"

        _global_emitter.emit_reasoning("memory", content, memory_metadata)


def emit_memory_emit(content: str, metadata: Optional[Dict[str, Any]] = None):
    """
    Emit a memory emit event - for when memory operations are actively happening.
    This will show memory in purple color on the frontend.

    Args:
        content: The memory emit content to display
        metadata: Additional metadata for the memory emit
    """
    if _global_emitter:
        memory_metadata = metadata or {}
        memory_metadata.update(
            {
                "memory_emit": True,
                "emit_type": "memory_emit",
            }
        )
        _global_emitter.emit_reasoning("memory", content, memory_metadata)


def get_reasoning_events() -> List[Dict[str, Any]]:
    """Get all collected reasoning events from the global emitter."""
    if _global_emitter:
        return _global_emitter.get_events()
    return []


def clear_reasoning_events():
    """Clear all collected reasoning events from the global emitter."""
    if _global_emitter:
        _global_emitter.clear_events()


def emit_content(content: str, metadata: Optional[Dict[str, Any]] = None):
    """Convenience function to emit content event."""
    if _global_emitter:
        _global_emitter.emit_content(content, metadata)


def emit_session_id(session_id: str):
    """Convenience function to emit session ID event."""
    if _global_emitter:
        _global_emitter.emit_session_id(session_id)
