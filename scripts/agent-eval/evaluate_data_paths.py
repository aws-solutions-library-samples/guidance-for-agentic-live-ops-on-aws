#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Data Path Evaluation — tests Athena SQL correctness and live metrics tool usage.

Complements the KB eval (tests RAG retrieval) and online agent eval (tests overall quality)
by specifically validating that:
  1. Athena queries: agents generate correct SQL, return expected row counts and values
  2. Live metrics: agents call the right tools (query_live_metrics vs get_recent_reports)
     and accurately reflect the data returned

Usage:
    python scripts/agent-eval/evaluate_data_paths.py --stage dev
    python scripts/agent-eval/evaluate_data_paths.py --stage dev --type athena
    python scripts/agent-eval/evaluate_data_paths.py --stage dev --type live
"""

import argparse
import json
import re
import time
import uuid
from pathlib import Path

import boto3

PROJECT_ID = "liveops"
REGION = "us-west-2"
JUDGE_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

# ---------------------------------------------------------------------------
# Eval dataset: each entry has a question, expected data path, and validation
# ---------------------------------------------------------------------------

ATHENA_EVAL_QUESTIONS = [
    {
        "question": "How many players are in each segment?",
        "expected_tool": "query_data",
        "expected_tables": ["players"],
        "validation": {
            "description": "Should return counts for whale, dolphin, f2p_hardcore, casual segments",
            "must_contain": ["whale", "dolphin", "f2p_hardcore", "casual"],
            "row_count_range": [4, 4],
        },
    },
    {
        "question": "What is the average combat power for whale players?",
        "expected_tool": "query_data",
        "expected_tables": ["players"],
        "validation": {
            "description": "Should return a single aggregate value for whale segment avg combat power",
            "must_contain": ["whale"],
        },
    },
    {
        "question": "Which campaigns have the highest budget?",
        "expected_tool": "query_data",
        "expected_tables": ["campaigns"],
        "validation": {
            "description": "Should list campaigns ordered by budget descending",
            "must_contain": ["CAMP_"],
        },
    },
    {
        "question": "What are the top 5 most purchased items by total revenue?",
        "expected_tool": "query_data",
        "expected_tables": ["purchases"],
        "validation": {
            "description": "Should aggregate purchases by item_name with total revenue",
            "must_contain_any": [
                "Crystal Pack",
                "Starter Pack",
                "Character Shards",
                "Gear Bundle",
                "Energy Refill",
            ],
        },
    },
    {
        "question": "How many players are on iOS vs Android?",
        "expected_tool": "query_data",
        "expected_tables": ["players"],
        "validation": {
            "description": "Should return platform counts",
            "must_contain": ["ios", "android"],
            "row_count_range": [2, 2],
        },
    },
    {
        "question": "What is the D1, D7, and D30 retention rate by acquisition channel?",
        "expected_tool": "query_data",
        "expected_tables": ["user_acquisition"],
        "validation": {
            "description": "Should calculate retention percentages grouped by channel",
            "must_contain_any": ["organic", "referral", "facebook", "search"],
        },
    },
    {
        "question": "Which incidents had the highest number of affected players?",
        "expected_tool": "query_data",
        "expected_tables": ["incidents"],
        "validation": {
            "description": "Should list incidents ordered by affected_players descending",
            "must_contain": ["INC_"],
        },
    },
    {
        "question": "What are the most popular game modes by session count?",
        "expected_tool": "query_data",
        "expected_tables": ["gameplay"],
        "validation": {
            "description": "Should count sessions per game_mode",
            "must_contain_any": [
                "arena_battles",
                "fleet_battles",
                "story_mode",
                "guild_raids",
                "challenges",
            ],
        },
    },
]

LIVE_METRICS_EVAL_QUESTIONS = [
    {
        "question": "What's the current session drop rate?",
        "expected_tool": "query_live_metrics",
        "expected_event_type": "session_drop",
        "validation": {
            "description": "Should call query_live_metrics with event_type=session_drop",
        },
    },
    {
        "question": "Show me live battle error metrics for the last 30 minutes",
        "expected_tool": "query_live_metrics",
        "expected_event_type": "battle_error",
        "validation": {
            "description": "Should call query_live_metrics with event_type=battle_error",
        },
    },
    {
        "question": "Are there any active purchase failure spikes right now?",
        "expected_tool": "query_live_metrics",
        "expected_event_type": "purchase_failure",
        "validation": {
            "description": "Should call query_live_metrics with event_type=purchase_failure",
        },
    },
    {
        "question": "What alerts has the monitoring system detected recently?",
        "expected_tool": "get_recent_reports",
        "validation": {
            "description": "Should call get_recent_reports to fetch proactive analysis reports",
        },
    },
]


def get_runtime_arn(session: boto3.Session) -> str:
    """Find the AgentCore runtime ARN."""
    client = session.client("bedrock-agentcore-control", region_name=REGION)
    response = client.list_agent_runtimes(maxResults=10)
    runtimes = response.get("agentRuntimes", [])
    if not runtimes:
        raise RuntimeError("No AgentCore runtime found")
    # Return the first runtime (should only be one per account/region in this demo)
    return runtimes[0]["agentRuntimeArn"]


def invoke_and_capture(session: boto3.Session, runtime_arn: str, query: str) -> dict:
    """Invoke the agent and capture the full SSE stream including sources and reasoning."""
    client = session.client("bedrock-agentcore", region_name=REGION)
    session_id = f"eval-data-path-{uuid.uuid4().hex}"  # Must be 33+ chars

    payload = json.dumps(
        {
            "prompt": query,
            "session_id": session_id,
            "actor_id": "eval-data-path",
            "request_id": f"eval-dp-{int(time.time())}-{uuid.uuid4().hex[:6]}",
        }
    )

    response = client.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        runtimeSessionId=session_id,
        payload=payload,
        qualifier="DEFAULT",
    )

    body = response.get("response", b"")
    if hasattr(body, "read"):
        body = body.read()
    if isinstance(body, bytes):
        body = body.decode("utf-8")

    # Parse all SSE events
    result = {
        "content": "",
        "sources": None,
        "reasoning_events": [],
        "agent_events": [],
        "raw_length": len(body),
    }

    for line in body.split("\n"):
        line = line.strip()
        if not line.startswith("data: "):
            continue
        try:
            inner = json.loads(line[6:])
        except (json.JSONDecodeError, TypeError):
            inner = line[6:]

        # Handle double-wrapped SSE
        if isinstance(inner, str) and inner.startswith("data: "):
            try:
                event = json.loads(inner[6:].strip())
            except (json.JSONDecodeError, TypeError):
                continue
        elif isinstance(inner, dict):
            event = inner
        else:
            continue

        event_type = event.get("event_type", "")

        if event_type == "content":
            result["content"] = event.get("content", "")
        elif event_type == "sources":
            result["sources"] = {
                "kb_sources": event.get("kb_sources", []),
                "athena_queries": event.get("athena_queries", []),
                "data_points": event.get("data_points", []),
            }
        elif event_type == "reasoning":
            result["reasoning_events"].append(
                {
                    "type": event.get("reasoning_type", ""),
                    "content": str(event.get("content", ""))[:200],
                    "metadata": event.get("metadata", {}),
                }
            )
            # Track agent invocations
            meta = event.get("metadata", {})
            if meta.get("agent_type") or meta.get("agent_name"):
                result["agent_events"].append(
                    {
                        "agent_name": meta.get("agent_name", ""),
                        "agent_type": meta.get("agent_type", ""),
                        "status": meta.get("status", ""),
                    }
                )

    return result


def judge_with_llm(
    session: boto3.Session,
    question: str,
    response_text: str,
    expected: dict,
    sources: dict,
) -> dict:
    """Use an LLM to judge correctness and completeness of the response."""
    bedrock = session.client("bedrock-runtime", region_name=REGION)

    athena_info = ""
    if sources and sources.get("athena_queries"):
        for aq in sources["athena_queries"]:
            athena_info += (
                f"\nSQL: {aq.get('sql', 'N/A')}\nRows: {aq.get('row_count', 0)}\n"
            )
            if aq.get("sample_rows"):
                athena_info += f"Columns: {aq.get('columns', [])}\nSample: {aq['sample_rows'][:3]}\n"

    live_info = ""
    if sources and sources.get("data_points"):
        for dp in sources["data_points"]:
            live_info += (
                f"\nEvent: {dp.get('event_type')}, Count: {dp.get('total_count')}, "
            )
            live_info += f"Platforms: {dp.get('platforms', {})}, Regions: {dp.get('regions', {})}\n"

    prompt = f"""You are evaluating an AI analytics agent's response. Score it on two dimensions.

QUESTION: {question}

EXPECTED BEHAVIOR: {expected.get("validation", {}).get("description", "N/A")}

AGENT RESPONSE (first 1500 chars):
{response_text[:1500]}

ATHENA QUERIES EXECUTED:
{athena_info or "None"}

LIVE METRICS DATA:
{live_info or "None"}

Score each dimension 0.0 to 1.0:

1. CORRECTNESS: Did the agent use the right data source and return factually accurate information?
   - 1.0 = correct data source, accurate numbers
   - 0.5 = right data source but some inaccuracies
   - 0.0 = wrong data source or fabricated data

2. COMPLETENESS: Did the response fully answer the question with specific data?
   - 1.0 = complete answer with specific numbers/breakdowns
   - 0.5 = partial answer, missing some requested details
   - 0.0 = vague/generic answer without specific data

Respond ONLY with valid JSON:
{{"correctness": <float>, "completeness": <float>, "reasoning": "<one sentence>"}}"""

    try:
        resp = bedrock.invoke_model(
            modelId=JUDGE_MODEL,
            body=json.dumps(
                {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 200,
                    "messages": [{"role": "user", "content": prompt}],
                }
            ),
        )
        judge_body = json.loads(resp["body"].read())
        judge_text = judge_body["content"][0]["text"].strip()
        # Extract JSON from response
        match = re.search(r"\{[^}]+\}", judge_text)
        if match:
            return json.loads(match.group())
        return {
            "correctness": 0.0,
            "completeness": 0.0,
            "reasoning": "Failed to parse judge response",
        }
    except Exception as e:
        return {
            "correctness": 0.0,
            "completeness": 0.0,
            "reasoning": f"Judge error: {e}",
        }


def evaluate_athena_response(question_def: dict, result: dict) -> dict:
    """Evaluate whether the Athena data path was used correctly."""
    scores = {
        "tool_used": False,
        "correct_table": False,
        "has_sql": False,
        "has_results": False,
        "content_checks": [],
    }

    sources = result.get("sources") or {}
    athena_queries = sources.get("athena_queries", [])

    # Check if Athena was used
    if athena_queries:
        scores["tool_used"] = True
        scores["has_sql"] = True

        # Check if correct table was queried
        for aq in athena_queries:
            sql = aq.get("sql", "").lower()
            for table in question_def.get("expected_tables", []):
                if table in sql:
                    scores["correct_table"] = True
                    break
            if aq.get("row_count", 0) > 0:
                scores["has_results"] = True

    # Check content validation rules
    validation = question_def.get("validation", {})
    content_lower = result.get("content", "").lower()

    if "must_contain" in validation:
        for term in validation["must_contain"]:
            scores["content_checks"].append(
                {
                    "term": term,
                    "found": term.lower() in content_lower,
                }
            )

    if "must_contain_any" in validation:
        found_any = any(
            t.lower() in content_lower for t in validation["must_contain_any"]
        )
        scores["content_checks"].append(
            {
                "term": f"any of {validation['must_contain_any']}",
                "found": found_any,
            }
        )

    # Calculate composite score
    tool_score = 1.0 if scores["tool_used"] else 0.0
    table_score = 1.0 if scores["correct_table"] else 0.0
    results_score = 1.0 if scores["has_results"] else 0.0
    content_score = sum(1 for c in scores["content_checks"] if c["found"]) / max(
        len(scores["content_checks"]), 1
    )

    scores["composite"] = round(
        (
            tool_score * 0.25
            + table_score * 0.25
            + results_score * 0.25
            + content_score * 0.25
        ),
        2,
    )
    return scores


def evaluate_live_metrics_response(question_def: dict, result: dict) -> dict:
    """Evaluate whether the live metrics data path was used correctly."""
    scores = {
        "correct_agent": False,
        "correct_tool": False,
        "correct_event_type": False,
        "has_data": False,
    }

    sources = result.get("sources") or {}
    data_points = sources.get("data_points", [])

    # Check if Real-Time Monitor Agent was invoked
    for ae in result.get("agent_events", []):
        if (
            "real" in ae.get("agent_name", "").lower()
            or "realtime" in ae.get("agent_type", "").lower()
        ):
            scores["correct_agent"] = True
            break

    expected_tool = question_def.get("expected_tool", "")

    if expected_tool == "query_live_metrics":
        if data_points:
            scores["correct_tool"] = True
            scores["has_data"] = True
            expected_event = question_def.get("expected_event_type", "")
            if expected_event:
                for dp in data_points:
                    if dp.get("event_type") == expected_event:
                        scores["correct_event_type"] = True
                        break
            else:
                scores["correct_event_type"] = True
        # Even if data_points is empty, check if the response mentions the metric
        elif (
            question_def.get("expected_event_type", "")
            in result.get("content", "").lower()
        ):
            scores["correct_tool"] = True

    elif expected_tool == "get_recent_reports":
        # Reports don't produce data_points artifacts, check response content
        content = result.get("content", "").lower()
        if any(
            term in content
            for term in ["report", "alert", "monitoring", "detected", "analysis"]
        ):
            scores["correct_tool"] = True
            scores["has_data"] = True
            scores["correct_event_type"] = True

    agent_score = 1.0 if scores["correct_agent"] else 0.0
    tool_score = 1.0 if scores["correct_tool"] else 0.0
    event_score = 1.0 if scores["correct_event_type"] else 0.0
    data_score = 1.0 if scores["has_data"] else 0.0

    scores["composite"] = round(
        (agent_score * 0.3 + tool_score * 0.3 + event_score * 0.2 + data_score * 0.2), 2
    )
    return scores


def run_evaluation(session: boto3.Session, runtime_arn: str, eval_type: str) -> dict:
    """Run the full evaluation pipeline."""
    questions = []
    if eval_type in ("all", "athena"):
        questions.extend([("athena", q) for q in ATHENA_EVAL_QUESTIONS])
    if eval_type in ("all", "live"):
        questions.extend([("live", q) for q in LIVE_METRICS_EVAL_QUESTIONS])

    results = []
    total = len(questions)

    print(f"\nRunning {total} evaluation questions ({eval_type})...\n")
    print("=" * 70)

    for i, (qtype, qdef) in enumerate(questions, 1):
        question = qdef["question"]
        print(f"\n[{i}/{total}] {question}")
        print(f"  Type: {qtype} | Expected tool: {qdef.get('expected_tool', 'N/A')}")

        # Invoke agent
        try:
            capture = invoke_and_capture(session, runtime_arn, question)
        except Exception as e:
            print(f"  ERROR invoking agent: {e}")
            results.append(
                {
                    "question": question,
                    "type": qtype,
                    "error": str(e),
                    "path_score": {"composite": 0.0},
                    "llm_score": {"correctness": 0.0, "completeness": 0.0},
                }
            )
            continue

        content_preview = capture["content"][:150].replace("\n", " ")
        print(f"  Response: {content_preview}...")

        sources = capture.get("sources") or {}
        athena_count = len(sources.get("athena_queries", []))
        dp_count = len(sources.get("data_points", []))
        agent_count = len(capture.get("agent_events", []))
        print(
            f"  Sources: {athena_count} Athena queries, {dp_count} data points, {agent_count} agent events"
        )

        # Evaluate data path
        if qtype == "athena":
            path_score = evaluate_athena_response(qdef, capture)
        else:
            path_score = evaluate_live_metrics_response(qdef, capture)

        print(f"  Path score: {path_score['composite']}")

        # LLM judge
        llm_score = judge_with_llm(session, question, capture["content"], qdef, sources)
        print(
            f"  LLM judge: correctness={llm_score.get('correctness', 0)}, completeness={llm_score.get('completeness', 0)}"
        )
        print(f"  Reasoning: {llm_score.get('reasoning', 'N/A')}")

        results.append(
            {
                "question": question,
                "type": qtype,
                "path_score": path_score,
                "llm_score": llm_score,
                "sources_summary": {
                    "athena_queries": athena_count,
                    "data_points": dp_count,
                    "agent_events": agent_count,
                },
                "content_length": len(capture["content"]),
            }
        )

    return {"results": results, "eval_type": eval_type}


def print_summary(evaluation: dict):
    """Print evaluation summary."""
    results = evaluation["results"]
    if not results:
        print("\nNo results to summarize.")
        return

    print("\n" + "=" * 70)
    print("EVALUATION SUMMARY")
    print("=" * 70)

    # Group by type
    for qtype in ["athena", "live"]:
        type_results = [r for r in results if r["type"] == qtype]
        if not type_results:
            continue

        print(f"\n--- {qtype.upper()} DATA PATH ({len(type_results)} questions) ---\n")

        path_scores = [
            r["path_score"]["composite"] for r in type_results if "error" not in r
        ]
        correctness = [
            r["llm_score"].get("correctness", 0)
            for r in type_results
            if "error" not in r
        ]
        completeness = [
            r["llm_score"].get("completeness", 0)
            for r in type_results
            if "error" not in r
        ]

        if path_scores:
            print(
                f"  Path Score (tool/table/data):  avg={sum(path_scores) / len(path_scores):.2f}"
            )
        if correctness:
            print(
                f"  LLM Correctness:               avg={sum(correctness) / len(correctness):.2f}"
            )
        if completeness:
            print(
                f"  LLM Completeness:              avg={sum(completeness) / len(completeness):.2f}"
            )

        print()
        for r in type_results:
            if "error" in r:
                status = "ERROR"
                score = "N/A"
            else:
                ps = r["path_score"]["composite"]
                cs = r["llm_score"].get("correctness", 0)
                status = "PASS" if ps >= 0.5 and cs >= 0.5 else "FAIL"
                score = f"path={ps:.1f} correct={cs:.1f}"
            q = r["question"][:60]
            print(f"  [{status:5s}] {score:25s}  {q}")

    # Overall
    all_path = [r["path_score"]["composite"] for r in results if "error" not in r]
    all_correct = [
        r["llm_score"].get("correctness", 0) for r in results if "error" not in r
    ]
    all_complete = [
        r["llm_score"].get("completeness", 0) for r in results if "error" not in r
    ]
    errors = sum(1 for r in results if "error" in r)

    print(f"\n{'=' * 70}")
    print(f"OVERALL: {len(results)} questions, {errors} errors")
    if all_path:
        print(f"  Avg Path Score:    {sum(all_path) / len(all_path):.2f}")
        print(f"  Avg Correctness:   {sum(all_correct) / len(all_correct):.2f}")
        print(f"  Avg Completeness:  {sum(all_complete) / len(all_complete):.2f}")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Evaluate agent data path correctness")
    parser.add_argument("--stage", default="dev", help="Deployment stage")
    parser.add_argument(
        "--type",
        default="all",
        choices=["all", "athena", "live"],
        help="Which data path to evaluate",
    )
    args = parser.parse_args()

    print(f"Region: {REGION}")

    session = boto3.Session(region_name=REGION)

    # Find runtime
    runtime_arn = get_runtime_arn(session)
    print(f"Runtime: {runtime_arn}")

    # Run evaluation
    evaluation = run_evaluation(session, runtime_arn, args.type)

    # Print summary
    print_summary(evaluation)

    # Save results
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    output_dir = Path("reports")
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / f"data-path-eval-{timestamp}.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(evaluation, f, indent=2, default=str)
    print(f"\nResults saved to: {output_file}")


if __name__ == "__main__":
    main()
