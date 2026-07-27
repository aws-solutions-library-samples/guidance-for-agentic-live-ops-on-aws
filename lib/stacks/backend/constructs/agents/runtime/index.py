# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Agentic Live Ops System

Multi-agent system for mobile analytics with specialized AI agents:
- 🎯 Player Character Targeting: Predicts character demand
- 📊 Player Segmentation: Creates dynamic segments for campaigns
- 🚀 Acquisition Optimization: Optimizes user acquisition campaigns
- 🔍 Fact-Checking: Verifies analytical accuracy
- 🎨 Visualization: Auto-generates charts from data

Usage:
- Command Line: python index.py "query"
- AgentCore: agentcore launch
- Streamlit: npm run dev

Memory Architecture:
- ✅ CDK creates a shared short-term memory space at deployment
- ✅ Memory ID passed to agent via BEDROCK_MEMORY_ID environment variable
- ✅ Each user gets their own session within the shared memory (based on actor_id)
- ✅ Simple memory tools for conversation history retrieval
- ✅ Automatic session management per actor
- ✅ Graceful error handling that doesn't break agent functionality
"""

import os
import time
import json
import boto3
from concurrent.futures import (
    ThreadPoolExecutor,
    TimeoutError as FuturesTimeoutError,
)
from aws_lambda_powertools import Logger
from bedrock_agentcore.memory.constants import ConversationalMessage, MessageRole
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from common.reasoning_emitter import (
    initialize_reasoning,
    get_reasoning_events,
)
from strands import Agent
from strands.models import BedrockModel
from common.utils import PromptLoader
from agent_factory import AgentFactory
from tools.realtime_monitor import (
    realtime_monitor_agent,
    get_live_metrics_artifacts,
    clear_live_metrics_artifacts,
)
from tools.athena_query import (
    create_athena_tools,
    get_athena_artifacts,
    clear_athena_artifacts,
)
from tools.schema_search import (
    create_schema_tools,
    get_schema_search_artifacts,
    clear_schema_search_artifacts,
)
from tools.schema_graph import (
    create_graph_tools,
    get_graph_query_artifacts,
    clear_graph_query_artifacts,
)
from tools.entity_resolution import (
    create_entity_resolution_tools,
    get_entity_link_artifacts,
    clear_entity_link_artifacts,
)
from tools.memory import (
    get_memory_session_manager as _get_memory_session_manager,
    MEMORY_ID,
)
from common.schema_context import (
    auto_schema_context,
    set_schema_context_cache,
)

# Configure AWS Lambda Powertools logger first
LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG")
logger = Logger(service="liveops", level=LOG_LEVEL)

# Configuration constants from environment variables
KB_ID = os.getenv("BEDROCK_KB_ID")  # Knowledge base ID (required)
if not KB_ID:
    raise ValueError("BEDROCK_KB_ID environment variable is required but not set")

# Per-agent model configuration from MODEL_CONFIG JSON env var
# Structure: { "defaultModelId": "...", "agents": { "agent_name": "model_id", ... } }
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
DOMAIN_LABEL = os.getenv("DOMAIN_LABEL", "generic")  # Domain context label
AWS_REGION = os.getenv("BEDROCK_REGION", "us-west-2")  # Region it run in

AGENT_MODELS: dict = _model_config.get("agents", {})

# Domain Context
DOMAIN_CONTEXT = f"""
Domain context: {DOMAIN_LABEL}. Analyze data and provide insights relevant to this domain.
"""

# Initialize the agent
app = BedrockAgentCoreApp()


def get_model_id_for_agent(agent_name: str = None) -> str:
    """Resolve the model ID for a specific agent from MODEL_CONFIG."""
    return (
        AGENT_MODELS.get(agent_name, DEFAULT_MODEL_ID)
        if agent_name
        else DEFAULT_MODEL_ID
    )


def get_bedrock_model(agent_name: str = None):
    """Create a new Bedrock model instance, optionally for a specific agent.

    Resolves model ID from MODEL_CONFIG JSON: agents.<agent_name> → defaultModelId → BEDROCK_MODEL_ID fallback.
    """
    model_id = get_model_id_for_agent(agent_name)
    return BedrockModel(
        model_id=model_id,
        region_name=AWS_REGION,
        temperature=0.3,
    )


###############################
# Agent Factory (dynamic agents from S3 → DynamoDB cache)
###############################

factory = AgentFactory(
    table_name=os.getenv("AGENT_CONFIG_TABLE"),
    bucket_name=os.getenv("AGENT_CONFIG_BUCKET"),
    cache_ttl=int(os.getenv("AGENT_CONFIG_CACHE_TTL", "300")),
)


# Main Analytics Orchestrator
def create_analytics_orchestrator(
    enable_memory: bool = True,
    actor_id: str = None,
) -> Agent:
    """Create and configure the main analytics orchestrator agent."""

    agent_tools = factory.get_agent_tools()

    # Only give the orchestrator direct Athena/schema tools as fallback
    # when no sub-agents are available. When sub-agents exist, they have
    # their own Athena tools and the orchestrator should delegate to them.
    if agent_tools:
        logger.info(
            "🤖 ORCHESTRATOR MODE: Sub-agents available — orchestrator will DELEGATE queries",
            {
                "mode": "delegation",
                "agent_count": len(agent_tools),
                "agent_names": [
                    t.__name__ for t in agent_tools if hasattr(t, "__name__")
                ],
                "has_direct_athena": False,
            },
        )
        orchestrator_tools = (
            agent_tools
            + [realtime_monitor_agent]  # hardcoded exception (Requirement 6.5)
            + create_schema_tools()  # schema discovery still useful for orchestrator context
            + create_graph_tools()
            + create_entity_resolution_tools()
        )
    else:
        logger.warning(
            "⚠️ ORCHESTRATOR MODE: No sub-agents — orchestrator will query Athena DIRECTLY",
            {
                "mode": "direct",
                "agent_count": 0,
                "has_direct_athena": True,
            },
        )
        # Fallback: no sub-agents available, give orchestrator direct query access
        orchestrator_tools = (
            [realtime_monitor_agent]
            + create_athena_tools()
            + create_schema_tools()
            + create_graph_tools()
            + create_entity_resolution_tools()
        )

    logger.info(
        "🔧 ORCHESTRATOR TOOLS",
        {
            "total_tools": len(orchestrator_tools),
            "tool_names": [
                t.__name__ for t in orchestrator_tools if hasattr(t, "__name__")
            ],
        },
    )

    base_prompt = PromptLoader.get_prompt(
        "orchestrator", DOMAIN_CONTEXT, domain_label=DOMAIN_LABEL
    )

    return Agent(
        model=get_bedrock_model("orchestrator"),
        system_prompt=base_prompt,
        callback_handler=None,
        tools=orchestrator_tools,
    )


async def stream_orchestrator_execution(
    orchestrator,
    enhanced_prompt,
    request_id,
    start_time=None,
):
    """Execute orchestrator with real-time streaming of agent events."""
    import asyncio
    from contextlib import redirect_stdout

    # Create a custom stdout capture that yields events in real-time
    class StreamingCapture:
        def __init__(self):
            self.buffer = ""
            self.events = []

        def write(self, text):
            self.buffer += text
            # Check for complete SSE events (data: {...}\n\n)
            while "data: " in self.buffer and "\n\n" in self.buffer:
                start = self.buffer.find("data: ")
                end = self.buffer.find("\n\n", start)
                if start != -1 and end != -1:
                    event_line = self.buffer[start : end + 2]
                    self.events.append(event_line)
                    self.buffer = self.buffer[end + 2 :]
                else:
                    break
            return len(text)

        def flush(self):
            pass

        def get_events(self):
            events = self.events.copy()
            self.events.clear()
            return events

    # Capture stdout during orchestrator execution
    capture = StreamingCapture()

    def run_orchestrator():
        with redirect_stdout(capture):
            return orchestrator(enhanced_prompt)

    # Run orchestrator in thread and stream events
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(run_orchestrator)

        # Poll for events while orchestrator is running
        while not future.done():
            await asyncio.sleep(0.1)  # Check every 100ms
            events = capture.get_events()
            for event in events:
                yield event

        # Get final result
        try:
            result = future.result()

            # Yield any remaining events
            events = capture.get_events()
            for event in events:
                yield event

            # Store result in reasoning emitter for later retrieval
            if hasattr(result, "__str__"):
                result_str = str(result)

                # Apply personality formatting before emitting
                formatted_result = result_str

                # Emit orchestrator's final result as an agent event for reasoning modal
                orchestrator_duration = time.time() - (start_time or time.time())
                yield f"data: {
                    json.dumps(
                        {
                            'event_type': 'reasoning',
                            'reasoning_type': 'agent',
                            'content': formatted_result,
                            'timestamp': time.time(),
                            'metadata': {
                                'agent_name': 'Agentic Live Ops Orchestrator',
                                'agent_type': 'orchestrator',
                                'status': 'completed',
                                'agent_result': formatted_result,
                                'result_length': len(formatted_result),
                                'duration_ms': round(orchestrator_duration * 1000, 2),
                                'model_id': get_model_id_for_agent('orchestrator'),
                            },
                        }
                    )
                }\n\n"

                # Emit final content event with personality formatting
                # NOTE: content event is now ALSO emitted by process_query_streaming
                # as a reliable fallback. To avoid duplication, skip it here.
                # The orchestrator reasoning event above already carries the result
                # in metadata.agent_result for the reasoning visualizer.

        except Exception as e:
            logger.error(
                f"Orchestrator execution failed: {e}",
                extra={"request_id": request_id},
            )
            yield f"data: {
                json.dumps(
                    {
                        'event_type': 'error',
                        'error': f'An error occurred while processing your request. Reference ID: {request_id}. Please try again.',
                        'timestamp': time.time(),
                    }
                )
            }\n\n"


async def process_query_streaming(
    query: str,
    actor_id: str = None,
    session_id: str = None,
    request_id: str = None,
):
    """Process query through orchestrator with real-time streaming of events."""
    try:
        # Initialize reasoning emitter for this request
        initialize_reasoning(request_id)
        clear_athena_artifacts()  # Reset Athena query tracking for this request
        clear_live_metrics_artifacts()  # Reset live metrics tracking for this request
        clear_schema_search_artifacts()  # Reset schema search tracking for this request
        clear_graph_query_artifacts()  # Reset graph query tracking for this request
        clear_entity_link_artifacts()  # Reset entity link tracking for this request

        # Emit session ID immediately for frontend tracking
        if session_id:
            yield f"data: {
                json.dumps(
                    {
                        'event_type': 'session_id',
                        'session_id': session_id,
                        'timestamp': time.time(),
                    }
                )
            }\n\n"

        # Ensure query is a string
        query_str = str(query) if not isinstance(query, str) else query

        # Check if memory is disabled
        memory_disabled = os.getenv("DISABLE_MEMORY", "false").lower() == "true"
        # Use lazy resolver — MEMORY_ID env var may be unset when BEDROCK_MEMORY_NAME
        # is provided instead (CDK passes name, runtime resolves ID on first call).
        resolved_memory = _get_memory_session_manager()
        enable_memory = (
            not memory_disabled and actor_id and session_id and resolved_memory
        )

        if memory_disabled:
            logger.info("Memory is disabled via DISABLE_MEMORY environment variable")
        elif not resolved_memory:
            logger.warning(
                "Memory not available - could not resolve from BEDROCK_MEMORY_ID or BEDROCK_MEMORY_NAME"
            )

        # Step 1: Retrieve conversation history from memory
        conversation_history_str = ""
        if actor_id and session_id and enable_memory and resolved_memory:
            try:
                logger.info(
                    "Retrieving conversation history from memory",
                    extra={"actor_id": actor_id, "session_id": session_id},
                )

                session = _get_memory_session_manager().create_memory_session(
                    actor_id=actor_id, session_id=session_id
                )

                turns = session.get_last_k_turns(k=5)

                if turns and len(turns) > 0:
                    conversation_history_str = "**CONVERSATION HISTORY:**\n"
                    for i, turn in enumerate(turns):
                        conversation_history_str += f"Turn {i + 1}: {str(turn)}\n"

                    # Emit single consolidated memory event with final result
                    yield f"data: {
                        json.dumps(
                            {
                                'event_type': 'reasoning',
                                'reasoning_type': 'memory',
                                'content': f'Retrieved {len(turns)} conversation turns from memory',
                                'timestamp': time.time(),
                                'metadata': {
                                    'memory_operation': 'retrieve',
                                    'memory_status': 'success',
                                    'turns_count': len(turns),
                                    'actor_id': actor_id,
                                    'session_id': session_id,
                                },
                            }
                        )
                    }\n\n"

                    logger.info(
                        "Conversation history retrieved",
                        extra={
                            "turns_count": len(turns),
                            "history_length": len(conversation_history_str),
                        },
                    )
                else:
                    # Emit single consolidated memory event for no history found
                    yield f"data: {
                        json.dumps(
                            {
                                'event_type': 'reasoning',
                                'reasoning_type': 'memory',
                                'content': 'No previous conversation history found',
                                'timestamp': time.time(),
                                'metadata': {
                                    'memory_operation': 'retrieve',
                                    'memory_status': 'success',
                                    'turns_count': 0,
                                    'actor_id': actor_id,
                                    'session_id': session_id,
                                },
                            }
                        )
                    }\n\n"
                    logger.info("No conversation history found")

            except Exception as e:
                logger.warning(
                    f"Failed to retrieve conversation history: {e}. Continuing without history."
                )
                # Emit single consolidated memory event for error
                yield f"data: {
                    json.dumps(
                        {
                            'event_type': 'reasoning',
                            'reasoning_type': 'memory',
                            'content': 'Memory retrieval skipped - continuing with fresh context',
                            'timestamp': time.time(),
                            'metadata': {
                                'memory_operation': 'retrieve',
                                'memory_status': 'error',
                                'error': str(e),
                                'actor_id': actor_id,
                                'session_id': session_id,
                            },
                        }
                    )
                }\n\n"

        # Step 2: Retrieve from knowledge base
        kb_sources_metadata = []  # Collect source metadata for frontend
        try:
            logger.info(
                "Retrieving from knowledge base",
                extra={"query": query_str, "kb_id": KB_ID},
            )

            kb_query = query_str
            bedrock_agent_runtime = boto3.client(
                "bedrock-agent-runtime", region_name=AWS_REGION
            )

            def retrieve_from_kb():
                return bedrock_agent_runtime.retrieve(
                    knowledgeBaseId=KB_ID,
                    retrievalQuery={"text": kb_query},
                    retrievalConfiguration={
                        "vectorSearchConfiguration": {
                            "numberOfResults": 20,
                            "overrideSearchType": "SEMANTIC",
                        }
                    },
                )

            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(retrieve_from_kb)
                try:
                    kb_response = future.result(timeout=15)
                except FuturesTimeoutError:
                    raise TimeoutError(
                        "Knowledge base retrieval timed out after 15 seconds"
                    )

            results = kb_response.get("retrievalResults", [])

            if results:
                kb_texts = []
                for i, result in enumerate(results):
                    score = result.get("score", 0)
                    if score >= 0.6:
                        content = result.get("content", {}).get("text", "")
                        source_uri = (
                            result.get("location", {})
                            .get("s3Location", {})
                            .get("uri", "")
                        )
                        if content:
                            kb_texts.append(
                                f"[Source {i + 1}] (Relevance: {score:.2f})\n{content}"
                            )
                            kb_sources_metadata.append(
                                {
                                    "source_index": i + 1,
                                    "relevance_score": round(score, 2),
                                    "source_uri": source_uri,
                                    "content": content[:500],
                                }
                            )

                if kb_texts:
                    kb_context_str = "\n\n".join(kb_texts[:5])
                    # Emit single consolidated knowledge base event with final result
                    yield f"data: {
                        json.dumps(
                            {
                                'event_type': 'reasoning',
                                'reasoning_type': 'knowledgebase',
                                'content': f'Found {len(kb_texts)} relevant data sources from knowledge base',
                                'timestamp': time.time(),
                            }
                        )
                    }\n\n"
                    logger.info(
                        "Knowledge base retrieval successful",
                        extra={
                            "query": query_str,
                            "kb_context_length": len(kb_context_str),
                            "results_count": len(kb_texts),
                        },
                    )
                else:
                    kb_context_str = "No relevant data found in knowledge base for this query (all results below relevance threshold)."
                    # Emit single consolidated knowledge base event for no relevant results
                    yield f"data: {
                        json.dumps(
                            {
                                'event_type': 'reasoning',
                                'reasoning_type': 'knowledgebase',
                                'content': 'No relevant data found in knowledge base - proceeding with general analysis',
                                'timestamp': time.time(),
                            }
                        )
                    }\n\n"
            else:
                kb_context_str = (
                    "No relevant data found in knowledge base for this query."
                )
                # Emit single consolidated knowledge base event for no results
                yield f"data: {
                    json.dumps(
                        {
                            'event_type': 'reasoning',
                            'reasoning_type': 'knowledgebase',
                            'content': 'No data found in knowledge base - proceeding with general analysis',
                            'timestamp': time.time(),
                        }
                    )
                }\n\n"

        except TimeoutError as e:
            logger.error(
                "Knowledge base retrieval timed out",
                extra={"error": str(e), "query": query_str, "timeout_seconds": 15},
            )
            kb_context_str = (
                "Knowledge base retrieval timed out. Proceeding with general analysis."
            )
            # Emit single consolidated knowledge base event for timeout
            yield f"data: {
                json.dumps(
                    {
                        'event_type': 'reasoning',
                        'reasoning_type': 'knowledgebase',
                        'content': 'Knowledge base retrieval timed out - proceeding with general analysis',
                        'timestamp': time.time(),
                    }
                )
            }\n\n"
        except Exception as e:
            logger.error(
                "Knowledge base retrieval failed",
                extra={"error": str(e), "query": query_str},
            )
            kb_context_str = "Knowledge base temporarily unavailable. Proceeding with general analysis."
            yield f"data: {
                json.dumps(
                    {
                        'event_type': 'reasoning',
                        'reasoning_type': 'analysis',
                        'content': 'Knowledge base temporarily unavailable - proceeding with general analysis',
                        'timestamp': time.time(),
                    }
                )
            }\n\n"

        # Step 3: Create orchestrator and process query
        yield f"data: {
            json.dumps(
                {
                    'event_type': 'reasoning',
                    'reasoning_type': 'agent',
                    'content': 'Initializing Agentic Live Ops orchestrator and specialized agents...',
                    'timestamp': time.time(),
                    'metadata': {
                        'agent_name': 'Agentic Live Ops Orchestrator',
                        'agent_type': 'orchestrator',
                        'status': 'initializing',
                        'model_id': get_model_id_for_agent('orchestrator'),
                    },
                }
            )
        }\n\n"

        orchestrator = create_analytics_orchestrator(enable_memory, actor_id=actor_id)

        # Build enhanced prompt
        enhanced_prompt = f"Query: {query_str}\n\n"

        if conversation_history_str:
            enhanced_prompt += f"{conversation_history_str}\n\n"
            enhanced_prompt += "**INSTRUCTION:** Use the conversation history above to provide context-aware responses.\n\n"

        enhanced_prompt += f"**KNOWLEDGE BASE CONTEXT:**\n{kb_context_str}\n\n"

        # Add auto-discovered schema context
        schema_context = auto_schema_context(query_str)
        if schema_context:
            enhanced_prompt += f"{schema_context}\n\n"
            set_schema_context_cache(schema_context, query_str)

        enhanced_prompt += "**CRITICAL INSTRUCTION:** Provide ONLY facts, data, and actionable suggestions. NEVER ask questions.\n\n"

        # Emit the constructed prompt as a reasoning event so it's visible in the AI reasoning visualizer
        yield f"data: {json.dumps({'event_type': 'reasoning', 'reasoning_type': 'analysis', 'content': 'Orchestrator prompt constructed with schema context', 'timestamp': time.time(), 'metadata': {'prompt_length': len(enhanced_prompt), 'has_schema_context': bool(schema_context) if 'schema_context' in dir() else False, 'enhanced_prompt': enhanced_prompt[:3000]}})}\n\n"

        # Generate response through analytics orchestrator with real-time streaming
        logger.info(
            "🚀 CALLING ORCHESTRATOR - About to call orchestrator with agent tools",
            {
                "enhanced_prompt_length": len(enhanced_prompt),
                "orchestrator_tools_count": len(orchestrator.tools)
                if hasattr(orchestrator, "tools")
                else 0,
                "request_id": request_id,
            },
        )

        # Stream orchestrator execution with real-time agent events
        orchestrator_start_time = time.time()
        result = None
        async for event in stream_orchestrator_execution(
            orchestrator,
            enhanced_prompt,
            request_id,
            orchestrator_start_time,
        ):
            # Check if this is the final content event or orchestrator completed event
            if event.startswith("data: "):
                try:
                    event_data = json.loads(event[6:].strip())
                    if event_data.get("event_type") == "content":
                        result = event_data.get("content", "")
                    elif (
                        event_data.get("event_type") == "reasoning"
                        and event_data.get("reasoning_type") == "agent"
                        and event_data.get("metadata", {}).get("status") == "completed"
                        and event_data.get("metadata", {}).get("agent_type")
                        == "orchestrator"
                    ):
                        # Capture orchestrator result as fallback
                        if not result:
                            result = event_data.get("metadata", {}).get(
                                "agent_result", ""
                            )
                except (json.JSONDecodeError, KeyError, TypeError):
                    pass
            yield event

        # Fallback if no result was captured
        if not result:
            result = "Analysis completed successfully."

        # Get reasoning events for logging
        reasoning_events = get_reasoning_events()

        orchestrator_duration = time.time() - orchestrator_start_time
        logger.info(
            "✅ ORCHESTRATOR COMPLETED - Orchestrator finished processing",
            {
                "result_length": len(result),
                "request_id": request_id,
                "total_events": len(reasoning_events),
                "duration_ms": round(orchestrator_duration * 1000, 2),
            },
        )

        yield f"data: {
            json.dumps(
                {
                    'event_type': 'reasoning',
                    'reasoning_type': 'analysis',
                    'content': 'Analysis complete - preparing final response',
                    'timestamp': time.time(),
                }
            )
        }\n\n"

        # Emit sources event for frontend to display citations
        athena_artifacts = get_athena_artifacts()
        live_metrics_artifacts = get_live_metrics_artifacts()
        schema_search_artifacts = get_schema_search_artifacts()
        graph_query_artifacts = get_graph_query_artifacts()
        entity_link_artifacts = get_entity_link_artifacts()
        logger.info(
            "Sources collection complete",
            extra={
                "kb_sources_count": len(kb_sources_metadata),
                "athena_count": len(athena_artifacts),
                "live_metrics_count": len(live_metrics_artifacts),
                "schema_search_count": len(schema_search_artifacts),
                "graph_query_count": len(graph_query_artifacts),
                "entity_link_count": len(entity_link_artifacts),
            },
        )
        if (
            kb_sources_metadata
            or athena_artifacts
            or live_metrics_artifacts
            or schema_search_artifacts
            or graph_query_artifacts
            or entity_link_artifacts
        ):
            yield f"data: {
                json.dumps(
                    {
                        'event_type': 'sources',
                        'kb_sources': kb_sources_metadata[:10],
                        'athena_queries': athena_artifacts[:10],
                        'data_points': live_metrics_artifacts[:10],
                        'schema_searches': schema_search_artifacts[:10],
                        'graph_queries': graph_query_artifacts[:10],
                        'entity_links': entity_link_artifacts[:10],
                        'timestamp': time.time(),
                    }
                )
            }\n\n"

        # Emit content event here (not in stream_orchestrator_execution) because
        # AgentCore may drop the last yields from the inner generator before they
        # reach the stream function.  Emitting at this level ensures the frontend
        # receives the final answer text.
        if result:
            yield f"data: {json.dumps({'event_type': 'content', 'content': result, 'timestamp': time.time()})}\n\n"

        # Emit completion event
        yield f"data: {
            json.dumps(
                {
                    'event_type': 'complete',
                    'timestamp': time.time(),
                }
            )
        }\n\n"

        # Save conversation to memory
        if enable_memory and actor_id and session_id and _get_memory_session_manager():
            try:
                session = _get_memory_session_manager().create_memory_session(
                    actor_id=actor_id, session_id=session_id
                )

                user_message = ConversationalMessage(query_str, MessageRole.USER)
                assistant_message = ConversationalMessage(result, MessageRole.ASSISTANT)

                session.add_turns(messages=[user_message, assistant_message])

                logger.info(
                    "💾 MEMORY SAVED - Conversation turn saved to memory",
                    extra={
                        "memory_id": MEMORY_ID,
                        "session_id": session_id,
                        "actor_id": actor_id,
                        "conversation_completion_timestamp": time.time(),
                    },
                )
            except Exception as e:
                logger.error(
                    "Failed to save conversation to memory",
                    extra={
                        "error": str(e),
                        "session_id": session_id,
                        "actor_id": actor_id,
                    },
                )

        logger.info(
            "Query processed successfully",
            extra={
                "query": query,
                "session_id": session_id,
                "actor_id": actor_id,
                "processing_complete_timestamp": time.time(),
            },
        )

    except Exception as e:
        logger.error(
            "Query processing failed",
            extra={"error": str(e), "query": query, "request_id": request_id},
        )
        yield f"data: {
            json.dumps(
                {
                    'event_type': 'error',
                    'error': f'An error occurred while processing your request. Reference ID: {request_id}. Please try again.',
                    'timestamp': time.time(),
                }
            )
        }\n\n"


@app.entrypoint
async def invoke(payload):
    """Main execution function supporting AgentCore streaming mode."""
    logger.debug(
        "Starting Agentic Live Ops system",
        extra={
            "kb_id": KB_ID,
            "model_id": DEFAULT_MODEL_ID,
            "domain_label": DOMAIN_LABEL,
            "log_level": LOG_LEVEL,
        },
    )

    if not payload:
        logger.warning("No payload provided - AgentCore mode requires a payload")
        yield f"data: {
            json.dumps(
                {
                    'event_type': 'error',
                    'error': 'Error: No payload provided. AgentCore mode requires a payload with prompt, session_id, and actor_id.',
                }
            )
        }\n\n"
        return

    # AgentCore mode
    query = payload.get(
        "prompt",
        "No prompt found in input. Please guide customer to create a json payload with prompt key",
    )
    session_id = payload.get("session_id", "default-session")
    actor_id = payload.get("actor_id", "testUser001")
    request_id = payload.get("request_id", f"agentcore-{actor_id}-{int(time.time())}")

    logger.info(
        "🔑 SESSION ID RECEIVED IN RUNTIME",
        extra={
            "query": query,
            "session_id": session_id,
            "actor_id": actor_id,
            "session_id_type": type(session_id).__name__,
            "session_id_length": len(str(session_id)) if session_id else 0,
            "payload_received_timestamp": time.time(),
            "full_payload": payload,
            "agentcore_invocation": True,
        },
    )

    logger.info(
        "Processing agentcore query",
        extra={
            "query": query,
            "session_id": session_id,
            "actor_id": actor_id,
            "processing_start_timestamp": time.time(),
        },
    )

    # Stream the query processing with real-time events
    async for event in process_query_streaming(
        query=query,
        actor_id=actor_id,
        session_id=session_id,
        request_id=request_id,
    ):
        yield event

    logger.info(
        "AgentCore query processed successfully",
        extra={
            "query": query,
            "session_id": session_id,
            "actor_id": actor_id,
            "processing_complete_timestamp": time.time(),
            "agentcore_response_ready": True,
        },
    )


# Entry point
if __name__ == "__main__":
    # AgentCore runtime entry point
    app.run()
