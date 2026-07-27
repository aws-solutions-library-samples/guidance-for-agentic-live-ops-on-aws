# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
AgentCore Agent Evaluation Script

Uses AgentCore Online Evaluations to continuously assess agent performance.
Two modes:
  1. setup: creates the online evaluation config (runs once)
  2. invoke: sends test queries to generate traces for evaluation
  3. results: fetches evaluation results from CloudWatch

Usage:
    # Step 1: Create online evaluation config
    python scripts/agent-eval/evaluate_agents.py --stage dev --action setup

    # Step 2: Invoke agent with test queries to generate traces
    python scripts/agent-eval/evaluate_agents.py --stage dev --action invoke --limit 5

    # Step 3: Check evaluation results (after traces are processed)
    python scripts/agent-eval/evaluate_agents.py --stage dev --action results

    # All-in-one: setup + invoke + wait + results
    python scripts/agent-eval/evaluate_agents.py --stage dev --action full --limit 5

Prerequisites:
    - AWS credentials configured
    - Stack deployed with AgentCore runtime
    - Transaction Search enabled in CloudWatch
"""

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

PROJECT_ID = "liveops"
REGION = "us-west-2"
DEFAULT_DATASET = Path(__file__).parent / "eval_dataset.jsonl"

EVALUATORS = [
    "Builtin.Helpfulness",
    "Builtin.Correctness",
    "Builtin.GoalSuccessRate",
    "Builtin.Coherence",
    "Builtin.ToolSelectionAccuracy",
]


def get_runtime_info(session: boto3.Session) -> dict:
    """Find the AgentCore runtime ARN, ID, and name."""
    client = session.client("bedrock-agentcore-control", region_name=REGION)
    response = client.list_agent_runtimes(maxResults=10)
    runtimes = response.get("agentRuntimes", [])
    if not runtimes:
        print("ERROR: No AgentCore runtimes found.")
        sys.exit(1)
    rt = runtimes[0]
    info = {
        "arn": rt.get("agentRuntimeArn", ""),
        "name": rt.get("agentRuntimeName", ""),
        "id": rt.get("agentRuntimeId", ""),
    }
    print(f"Runtime: {info['name']} ({info['id']})")
    return info


def get_or_create_eval_role(session: boto3.Session) -> str:
    """Get or create the IAM role for AgentCore evaluations."""
    iam = session.client("iam")
    account_id = session.client("sts").get_caller_identity()["Account"]
    role_name = "AgentCoreEvaluationRole"

    trust_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "TrustPolicyStatement",
                "Effect": "Allow",
                "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
                "Action": "sts:AssumeRole",
                "Condition": {
                    "StringEquals": {
                        "aws:SourceAccount": account_id,
                        "aws:ResourceAccount": account_id,
                    },
                    "ArnLike": {
                        "aws:SourceArn": [
                            f"arn:aws:bedrock-agentcore:{REGION}:{account_id}:evaluator/*",
                            f"arn:aws:bedrock-agentcore:{REGION}:{account_id}:online-evaluation-config/*",
                        ]
                    },
                },
            }
        ],
    }

    try:
        response = iam.get_role(RoleName=role_name)
        role_arn = response["Role"]["Arn"]
        print(f"Using existing role: {role_arn}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchEntity":
            response = iam.create_role(
                RoleName=role_name,
                AssumeRolePolicyDocument=json.dumps(trust_policy),
                Description="Role for AgentCore evaluation jobs",
            )
            role_arn = response["Role"]["Arn"]
            print(f"Created role: {role_arn}")
            time.sleep(10)
        else:
            raise

    # Attach permissions policy
    permissions_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "CloudWatchLogReadStatement",
                "Effect": "Allow",
                "Action": [
                    "logs:DescribeLogGroups",
                    "logs:GetQueryResults",
                    "logs:StartQuery",
                    "logs:GetLogEvents",
                    "logs:FilterLogEvents",
                    "logs:DescribeLogStreams",
                ],
                "Resource": "*",
            },
            {
                "Sid": "CloudWatchLogWriteStatement",
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                "Resource": f"arn:aws:logs:{REGION}:{account_id}:log-group:/aws/bedrock-agentcore/evaluations/*",
            },
            {
                "Sid": "CloudWatchIndexPolicyStatement",
                "Effect": "Allow",
                "Action": ["logs:DescribeIndexPolicies", "logs:PutIndexPolicy"],
                "Resource": [
                    f"arn:aws:logs:{REGION}:{account_id}:log-group:aws/spans",
                    f"arn:aws:logs:{REGION}:{account_id}:log-group:aws/spans:*",
                    f"arn:aws:logs:{REGION}:{account_id}:log-group:/aws/bedrock-agentcore/*",
                ],
            },
            {
                "Sid": "BedrockInvokeStatement",
                "Effect": "Allow",
                "Action": [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                ],
                "Resource": [
                    f"arn:aws:bedrock:{REGION}::foundation-model/*",
                    f"arn:aws:bedrock:{REGION}:{account_id}:inference-profile/*",
                ],
            },
        ],
    }

    iam.put_role_policy(
        RoleName=role_name,
        PolicyName="AgentCoreEvalPolicy",
        PolicyDocument=json.dumps(permissions_policy),
    )

    return role_arn


def setup_online_eval(session: boto3.Session, runtime_info: dict, role_arn: str) -> str:
    """Create or update the online evaluation config."""
    client = session.client("bedrock-agentcore-control", region_name=REGION)
    config_name = "gaming_agent_eval"

    # Check if config already exists
    try:
        existing = client.list_online_evaluation_configs(maxResults=20)
        for cfg in existing.get("onlineEvaluationConfigs", []):
            if cfg.get("onlineEvaluationConfigName") == config_name:
                config_id = cfg["onlineEvaluationConfigId"]
                print(f"Online eval config already exists: {config_name} ({config_id})")
                return config_id
    except ClientError:
        pass

    # Build service name from runtime: {runtimeName}.{endpointName}
    service_name = f"{runtime_info['name']}.DEFAULT"
    log_group = f"/aws/bedrock-agentcore/runtimes/{runtime_info['id']}-DEFAULT"

    print(f"Creating online eval config: {config_name}")
    print(f"  Service: {service_name}")
    print(f"  Log group: {log_group}")
    print(f"  Evaluators: {', '.join(EVALUATORS)}")
    print("  Sampling: 100%")

    # Retry with delay for IAM role propagation
    for attempt in range(3):
        try:
            response = client.create_online_evaluation_config(
                onlineEvaluationConfigName=config_name,
                description="Continuous evaluation of Agentic Live Ops",
                rule={"samplingConfig": {"samplingPercentage": 100.0}},
                dataSourceConfig={
                    "cloudWatchLogs": {
                        "logGroupNames": [log_group],
                        "serviceNames": [service_name],
                    }
                },
                evaluators=[{"evaluatorId": e} for e in EVALUATORS],
                evaluationExecutionRoleArn=role_arn,
                enableOnCreate=True,
            )
            config_id = response.get("onlineEvaluationConfigId", "unknown")
            print(f"Created: {config_name} ({config_id})")
            return config_id
        except ClientError as e:
            if "execution role" in str(e).lower() and attempt < 2:
                print(f"  Role not ready yet, waiting 15s... (attempt {attempt + 1}/3)")
                time.sleep(15)
            else:
                raise

    return ""


def invoke_agent(
    session: boto3.Session, runtime_arn: str, query: str, session_id: str
) -> str:
    """Invoke the AgentCore runtime with a query."""
    client = session.client("bedrock-agentcore", region_name=REGION)

    payload = json.dumps(
        {
            "prompt": query,
            "session_id": session_id,
            "actor_id": "eval-user",
            "request_id": f"eval-{int(time.time())}-{uuid.uuid4().hex[:6]}",
        }
    )

    try:
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

        # Parse double-wrapped SSE: data: "data: {...}\n\n"
        result_text = ""
        for line in body.split("\n"):
            line = line.strip()
            if not line.startswith("data: "):
                continue
            try:
                inner_line = json.loads(line[6:])
            except (json.JSONDecodeError, TypeError):
                inner_line = line[6:]

            if isinstance(inner_line, str) and inner_line.startswith("data: "):
                try:
                    event = json.loads(inner_line[6:].strip())
                    if event.get("event_type") == "content":
                        result_text = event.get("content", "")
                except (json.JSONDecodeError, KeyError):
                    pass

        return result_text or body[:3000]

    except Exception as e:
        return f"ERROR: {e}"


def invoke_test_queries(session: boto3.Session, runtime_arn: str, limit: int) -> str:
    """Send test queries to generate traces for evaluation."""
    dataset_path = DEFAULT_DATASET
    if not dataset_path.exists():
        print(f"ERROR: Dataset not found: {dataset_path}")
        sys.exit(1)

    questions = []
    with open(dataset_path, encoding="utf-8") as f:
        for line in f:
            entry = json.loads(line.strip())
            questions.append(
                entry["conversationTurns"][0]["prompt"]["content"][0]["text"]
            )

    if limit > 0:
        questions = questions[:limit]

    session_id = f"eval-session-{uuid.uuid4().hex}"
    print(f"Invoking {len(questions)} queries (session: {session_id})...\n")

    for i, query in enumerate(questions, 1):
        print(f"[{i}/{len(questions)}] {query[:60]}...")
        start = time.time()
        response = invoke_agent(session, runtime_arn, query, session_id)
        duration = time.time() - start
        print(f"  {len(response)} chars in {duration:.1f}s")

    print(f"\nAll queries invoked. Session: {session_id}")
    return session_id


def check_results(session: boto3.Session) -> None:
    """Check online evaluation results from CloudWatch."""
    client = session.client("bedrock-agentcore-control", region_name=REGION)
    logs = session.client("logs", region_name=REGION)

    # List configs
    configs = client.list_online_evaluation_configs(maxResults=10)
    for cfg in configs.get("onlineEvaluationConfigs", []):
        name = cfg.get("onlineEvaluationConfigName", "unknown")
        status = cfg.get("executionStatus", "unknown")
        config_id = cfg.get("onlineEvaluationConfigId", "")
        print(f"Config: {name} | Status: {status} | ID: {config_id}")

    # Query evaluation results log group
    eval_log_group = "/aws/bedrock-agentcore/evaluations"
    try:
        # Check if log group exists
        groups = logs.describe_log_groups(logGroupNamePrefix=eval_log_group)
        matching = [
            g
            for g in groups["logGroups"]
            if g["logGroupName"].startswith(eval_log_group)
        ]
        if not matching:
            print(
                "\nNo evaluation log group found yet. Results may take a few minutes to appear after traces are processed."
            )
            return

        log_group_name = matching[0]["logGroupName"]
        print(f"\nQuerying results from: {log_group_name}")

        qid = logs.start_query(
            logGroupName=log_group_name,
            startTime=int((datetime.now() - timedelta(hours=1)).timestamp()),
            endTime=int(datetime.now().timestamp()),
            queryString="fields @timestamp, @message | sort @timestamp desc | limit 50",
        )["queryId"]

        for _ in range(30):
            result = logs.get_query_results(queryId=qid)
            if result["status"] in ("Complete", "Failed"):
                break
            time.sleep(2)

        if result["status"] == "Complete" and result["results"]:
            print(f"\nFound {len(result['results'])} evaluation results:\n")

            scores_by_evaluator = {}
            for row in result["results"]:
                for field in row:
                    if field["field"] == "@message":
                        try:
                            msg = json.loads(field["value"])
                            attrs = msg.get("attributes", {})
                            evaluator = attrs.get("gen_ai.evaluation.name", "unknown")
                            score = attrs.get("gen_ai.evaluation.score.value")
                            label = attrs.get("gen_ai.evaluation.score.label", "")
                            explanation = attrs.get("gen_ai.evaluation.explanation", "")
                            session_id = attrs.get("session.id", "")
                            trace_id = msg.get("traceId", "")

                            if score is not None:
                                scores_by_evaluator.setdefault(evaluator, []).append(
                                    {
                                        "score": score,
                                        "label": label,
                                        "explanation": explanation[:200],
                                        "session_id": session_id,
                                        "trace_id": trace_id,
                                    }
                                )
                        except (json.JSONDecodeError, KeyError):
                            pass

            if scores_by_evaluator:
                print(f"\n{'=' * 60}")
                print("EVALUATION SUMMARY")
                print(f"{'=' * 60}")
                for name, entries in sorted(scores_by_evaluator.items()):
                    scores = [e["score"] for e in entries]
                    avg = sum(scores) / len(scores)
                    labels = [e["label"] for e in entries if e["label"]]
                    print(f"  {name:35s}  avg={avg:.2f}  n={len(scores)}")
                    if labels:
                        from collections import Counter

                        label_counts = Counter(labels)
                        print(f"    Labels: {dict(label_counts)}")

                # Save report
                report = {
                    "timestamp": datetime.now().isoformat(),
                    "evaluators": {
                        name: {
                            "avg_score": round(
                                sum(e["score"] for e in entries) / len(entries), 3
                            ),
                            "count": len(entries),
                            "labels": [e["label"] for e in entries],
                            "details": entries,
                        }
                        for name, entries in scores_by_evaluator.items()
                    },
                }
                output_path = f"reports/agent-eval-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
                Path("reports").mkdir(exist_ok=True)
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(report, f, indent=2)
                print(f"\nReport saved to: {output_path}")
            else:
                print(
                    "  No scored results found yet. The evaluation pipeline may still be processing."
                )
        else:
            print(
                "No results found yet. Evaluation results typically appear 2-5 minutes after traces are generated."
            )

    except ClientError as e:
        print(f"Could not query results: {e}")
        print(
            "Evaluation results may take a few minutes to appear after the first traces are processed."
        )


def main():
    parser = argparse.ArgumentParser(description="AgentCore Agent Evaluation (Online)")
    parser.add_argument("--stage", default="dev", help="Deployment stage")
    parser.add_argument(
        "--action",
        choices=["setup", "invoke", "results", "full"],
        default="full",
        help="Action: setup (create eval config), invoke (send test queries), results (check scores), full (all)",
    )
    parser.add_argument(
        "--limit", type=int, default=5, help="Max queries to invoke (default: 5)"
    )
    parser.add_argument(
        "--wait",
        type=int,
        default=180,
        help="Seconds to wait for results in full mode (default: 180)",
    )
    args = parser.parse_args()

    print(f"Region: {REGION}\n")

    session = boto3.Session(region_name=REGION)
    runtime_info = get_runtime_info(session)

    if args.action in ("setup", "full"):
        role_arn = get_or_create_eval_role(session)
        setup_online_eval(session, runtime_info, role_arn)
        print()

    if args.action in ("invoke", "full"):
        invoke_test_queries(session, runtime_info["arn"], args.limit)
        print()

    if args.action == "full":
        print(f"Waiting {args.wait}s for evaluation pipeline to process traces...")
        time.sleep(args.wait)
        print()

    if args.action in ("results", "full"):
        check_results(session)


if __name__ == "__main__":
    main()
