# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Bedrock Knowledge Base RAG Evaluation Script

Runs a retrieve-and-generate evaluation job against the deployed KB
using the Bedrock Evaluations API. Uploads the test dataset to S3,
creates the eval job, polls for completion, and prints results.

Usage:
    python scripts/kb-eval/evaluate_kb.py [--stage dev] [--metrics all]

Prerequisites:
    - AWS credentials configured (default chain or AWS_PROFILE)
    - Knowledge base deployed via CDK
    - pip install boto3
"""

import argparse
import json
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# Project defaults from cdk.json
PROJECT_ID = "liveops"
REGION = "us-west-2"
EVAL_DATASET_FILE = Path(__file__).parent / "eval_dataset.jsonl"
EVAL_DATASET_REMEDIATIONS_FILE = (
    Path(__file__).parent / "eval_dataset_remediations.jsonl"
)

# Evaluation config
EVALUATOR_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
GENERATOR_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
ALL_METRICS = [
    "Builtin.Correctness",
    "Builtin.Completeness",
    "Builtin.Helpfulness",
    "Builtin.LogicalCoherence",
    "Builtin.Faithfulness",
    "Builtin.Harmfulness",
    "Builtin.Stereotyping",
    "Builtin.Refusal",
]


def get_kb_id(session: boto3.Session, kb_name_filter: str = "") -> str:
    """Look up the knowledge base ID from the deployed stack."""
    client = session.client("bedrock-agent", region_name=REGION)
    response = client.list_knowledge_bases(maxResults=10)
    kbs = response.get("knowledgeBaseSummaries", [])
    if not kbs:
        print("ERROR: No knowledge bases found. Is the stack deployed?")
        sys.exit(1)

    # If a filter is provided, find the matching KB
    if kb_name_filter:
        for kb in kbs:
            if kb_name_filter.lower() in kb["name"].lower():
                print(f"Found knowledge base: {kb['name']} ({kb['knowledgeBaseId']})")
                return kb["knowledgeBaseId"]
        print(f"ERROR: No knowledge base matching '{kb_name_filter}' found.")
        print(f"Available KBs: {[kb['name'] for kb in kbs]}")
        sys.exit(1)

    # Default: list all and let user pick or use first
    if len(kbs) > 1:
        print("Multiple knowledge bases found:")
        for i, kb in enumerate(kbs):
            print(f"  [{i}] {kb['name']} ({kb['knowledgeBaseId']})")
        print("Use --kb-name to filter. Using first KB by default.")

    kb_id = kbs[0]["knowledgeBaseId"]
    kb_name = kbs[0]["name"]
    print(f"Found knowledge base: {kb_name} ({kb_id})")
    return kb_id


def find_eval_bucket(session: boto3.Session, stage: str) -> str:
    """Find the data source bucket from the deployed KB to reuse for eval data."""
    cf_client = session.client("cloudformation", region_name=REGION)
    # List stacks to find the backend stack
    stacks = cf_client.list_stacks(
        StackStatusFilter=["CREATE_COMPLETE", "UPDATE_COMPLETE"]
    )
    backend_stack = None
    for stack in stacks.get("StackSummaries", []):
        if (
            "backend" in stack["StackName"].lower()
            and stage in stack["StackName"].lower()
        ):
            backend_stack = stack["StackName"]
            break

    if not backend_stack:
        # Fallback: create a dedicated eval bucket
        return create_eval_bucket(session)

    # Look for the data source bucket in stack resources
    resources = cf_client.list_stack_resources(StackName=backend_stack)
    for resource in resources.get("StackResourceSummaries", []):
        if (
            resource["ResourceType"] == "AWS::S3::Bucket"
            and "datasource" in resource["LogicalResourceId"].lower()
        ):
            bucket_name = resource["PhysicalResourceId"]
            print(f"Using existing data bucket: {bucket_name}")
            return bucket_name

    return create_eval_bucket(session)


def create_eval_bucket(session: boto3.Session) -> str:
    """Create a dedicated bucket for eval datasets and results."""
    s3 = session.client("s3", region_name=REGION)
    account_id = session.client("sts").get_caller_identity()["Account"]
    bucket_name = f"kb-eval-{account_id}-{REGION}"
    try:
        s3.create_bucket(
            Bucket=bucket_name,
            CreateBucketConfiguration={"LocationConstraint": REGION},
        )
        print(f"Created eval bucket: {bucket_name}")
    except ClientError as e:
        if e.response["Error"]["Code"] in (
            "BucketAlreadyOwnedByYou",
            "BucketAlreadyExists",
        ):
            print(f"Using existing eval bucket: {bucket_name}")
        else:
            raise
    return bucket_name


def setup_cors(session: boto3.Session, bucket_name: str):
    """Set CORS on the bucket (required for Bedrock eval jobs)."""
    s3 = session.client("s3", region_name=REGION)
    try:
        s3.put_bucket_cors(
            Bucket=bucket_name,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedHeaders": ["*"],
                        "AllowedMethods": ["GET", "PUT", "POST"],
                        "AllowedOrigins": ["https://*.aws.amazon.com"],
                        "ExposeHeaders": ["ETag"],
                        "MaxAgeSeconds": 3000,
                    }
                ]
            },
        )
    except ClientError:
        pass  # Non-critical, only needed for console access


def upload_dataset(
    session: boto3.Session, bucket_name: str, dataset_file: Path = EVAL_DATASET_FILE
) -> str:
    """Upload the eval dataset to S3."""
    s3 = session.client("s3", region_name=REGION)
    s3_key = f"kb-eval/{dataset_file.name}"
    s3.upload_file(str(dataset_file), bucket_name, s3_key)
    s3_uri = f"s3://{bucket_name}/{s3_key}"
    print(f"Uploaded dataset to: {s3_uri}")
    return s3_uri


def get_or_create_eval_role(
    session: boto3.Session, bucket_name: str, kb_id: str
) -> str:
    """Get or create the IAM role for the evaluation job."""
    iam = session.client("iam")
    role_name = "BedrockKBEvaluationRole"
    account_id = session.client("sts").get_caller_identity()["Account"]

    trust_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "bedrock.amazonaws.com"},
                "Action": "sts:AssumeRole",
                "Condition": {
                    "StringEquals": {"aws:SourceAccount": account_id},
                },
            }
        ],
    }

    try:
        response = iam.get_role(RoleName=role_name)
        role_arn = response["Role"]["Arn"]
        print(f"Using existing IAM role: {role_arn}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchEntity":
            response = iam.create_role(
                RoleName=role_name,
                AssumeRolePolicyDocument=json.dumps(trust_policy),
                Description="Role for Bedrock KB evaluation jobs",
            )
            role_arn = response["Role"]["Arn"]
            print(f"Created IAM role: {role_arn}")
            # Wait for role propagation
            time.sleep(10)
        else:
            raise

    # Attach inline policy for S3 + Bedrock access
    eval_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "S3Access",
                "Effect": "Allow",
                "Action": [
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:ListBucket",
                    "s3:GetBucketLocation",
                ],
                "Resource": [
                    f"arn:aws:s3:::{bucket_name}",
                    f"arn:aws:s3:::{bucket_name}/*",
                ],
            },
            {
                "Sid": "BedrockAccess",
                "Effect": "Allow",
                "Action": [
                    "bedrock:InvokeModel",
                    "bedrock:Retrieve",
                    "bedrock:RetrieveAndGenerate",
                    "bedrock:GetFoundationModel",
                ],
                "Resource": ["*"],
            },
        ],
    }

    iam.put_role_policy(
        RoleName=role_name,
        PolicyName="BedrockKBEvalPolicy",
        PolicyDocument=json.dumps(eval_policy),
    )

    return role_arn


def create_eval_job(
    session: boto3.Session,
    kb_id: str,
    dataset_s3_uri: str,
    output_bucket: str,
    role_arn: str,
    metrics: list[str],
) -> str:
    """Create the Bedrock RAG evaluation job."""
    client = session.client("bedrock", region_name=REGION)
    job_name = (
        f"kb-eval-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    )
    output_s3_uri = f"s3://{output_bucket}/kb-eval/results/"

    eval_config = {
        "automated": {
            "datasetMetricConfigs": [
                {
                    "taskType": "General",
                    "dataset": {
                        "name": "kb_eval_dataset",
                        "datasetLocation": {"s3Uri": dataset_s3_uri},
                    },
                    "metricNames": metrics,
                }
            ],
            "evaluatorModelConfig": {
                "bedrockEvaluatorModels": [{"modelIdentifier": EVALUATOR_MODEL}]
            },
        }
    }

    inference_config = {
        "ragConfigs": [
            {
                "knowledgeBaseConfig": {
                    "retrieveAndGenerateConfig": {
                        "type": "KNOWLEDGE_BASE",
                        "knowledgeBaseConfiguration": {
                            "knowledgeBaseId": kb_id,
                            "modelArn": f"arn:aws:bedrock:{REGION}::foundation-model/{GENERATOR_MODEL}",
                        },
                    }
                }
            }
        ]
    }

    print(f"\nCreating evaluation job: {job_name}")
    print(f"  KB ID: {kb_id}")
    print(f"  Evaluator: {EVALUATOR_MODEL}")
    print(f"  Generator: {GENERATOR_MODEL}")
    print(f"  Metrics: {', '.join(metrics)}")
    print(f"  Output: {output_s3_uri}")

    response = client.create_evaluation_job(
        jobName=job_name,
        roleArn=role_arn,
        applicationType="RagEvaluation",
        evaluationConfig=eval_config,
        inferenceConfig=inference_config,
        outputDataConfig={"s3Uri": output_s3_uri},
    )

    job_arn = response["jobArn"]
    print(f"\nJob created: {job_arn}")
    return job_arn


def poll_job(session: boto3.Session, job_arn: str, timeout_minutes: int = 60) -> dict:
    """Poll the evaluation job until completion."""
    client = session.client("bedrock", region_name=REGION)
    start_time = time.time()
    timeout_seconds = timeout_minutes * 60

    print(f"\nPolling job status (timeout: {timeout_minutes} min)...")
    while True:
        response = client.get_evaluation_job(jobIdentifier=job_arn)
        status = response["status"]
        elapsed = int(time.time() - start_time)

        print(f"  [{elapsed}s] Status: {status}")

        if status == "Completed":
            print("\nEvaluation completed successfully!")
            return response
        elif status in ("Failed", "Stopped", "Deleting"):
            print(f"\nEvaluation {status.lower()}.")
            if "failureMessages" in response:
                for msg in response["failureMessages"]:
                    print(f"  Error: {msg}")
            return response

        if elapsed > timeout_seconds:
            print(f"\nTimeout after {timeout_minutes} minutes. Job still running.")
            print(
                f"Check status manually: aws bedrock get-evaluation-job --job-identifier {job_arn} --region {REGION}"
            )
            return response

        time.sleep(30)


def print_results(session: boto3.Session, job_response: dict):
    """Download and display evaluation results."""
    if job_response.get("status") != "Completed":
        return

    output_uri = job_response.get("outputDataConfig", {}).get("s3Uri", "")
    if not output_uri:
        print("No output URI found in job response.")
        return

    print(f"\nResults saved to: {output_uri}")
    print("\nTo view detailed results:")
    print(f"  aws s3 ls {output_uri} --recursive --region {REGION}")
    print(f"  aws s3 cp {output_uri} ./kb-eval-results/ --recursive --region {REGION}")

    # Try to download and display summary
    s3 = session.client("s3", region_name=REGION)
    bucket = output_uri.replace("s3://", "").split("/")[0]
    prefix = "/".join(output_uri.replace("s3://", "").split("/")[1:])

    try:
        objects = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        for obj in objects.get("Contents", []):
            if obj["Key"].endswith(".json"):
                response = s3.get_object(Bucket=bucket, Key=obj["Key"])
                content = json.loads(response["Body"].read().decode("utf-8"))
                print(f"\n--- {obj['Key'].split('/')[-1]} ---")
                print(json.dumps(content, indent=2)[:3000])  # Truncate large outputs
    except ClientError as e:
        print(f"Could not fetch results: {e}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate Bedrock Knowledge Base")
    parser.add_argument(
        "--stage", default="dev", help="Deployment stage (default: dev)"
    )
    parser.add_argument(
        "--metrics",
        default="all",
        help="Comma-separated metrics or 'all' (default: all)",
    )
    parser.add_argument(
        "--no-poll",
        action="store_true",
        help="Create job and exit without waiting for results",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="Polling timeout in minutes (default: 60)",
    )
    parser.add_argument(
        "--kb-name",
        default="",
        help="Filter knowledge base by name (e.g., 'remediations' or 'knowledgeBase')",
    )
    args = parser.parse_args()

    # Resolve metrics
    if args.metrics == "all":
        metrics = ALL_METRICS
    else:
        metrics = [
            f"Builtin.{m.strip()}" if not m.startswith("Builtin.") else m.strip()
            for m in args.metrics.split(",")
        ]

    print(f"Region: {REGION}\n")

    session = boto3.Session(region_name=REGION)

    # Step 1: Find KB
    kb_id = get_kb_id(session, kb_name_filter=args.kb_name)

    # Step 2: Find/create bucket and upload dataset
    bucket_name = find_eval_bucket(session, args.stage)
    setup_cors(session, bucket_name)

    # Select dataset based on KB name
    dataset_file = EVAL_DATASET_FILE
    if args.kb_name and "remediation" in args.kb_name.lower():
        dataset_file = EVAL_DATASET_REMEDIATIONS_FILE
        print(f"Using remediations dataset: {dataset_file.name}")
    else:
        print(f"Using player data dataset: {dataset_file.name}")

    dataset_uri = upload_dataset(session, bucket_name, dataset_file)

    # Step 3: Set up IAM role
    role_arn = get_or_create_eval_role(session, bucket_name, kb_id)

    # Step 4: Create evaluation job
    job_arn = create_eval_job(
        session, kb_id, dataset_uri, bucket_name, role_arn, metrics
    )

    # Step 5: Poll and display results
    if args.no_poll:
        print("\nJob submitted. Check status with:")
        print(
            f"  aws bedrock get-evaluation-job --job-identifier {job_arn} --region {REGION}"
        )
    else:
        result = poll_job(session, job_arn, timeout_minutes=args.timeout)
        print_results(session, result)


if __name__ == "__main__":
    main()
