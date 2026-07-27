# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Hydrate Athena tables by uploading seed CSV data to the correct S3 prefixes.

Run this once after deploying the stack to populate Athena with historical data.
After hydration, new data flows in via Kinesis → DynamoDB → sync Lambda.

Usage:
    python scripts/hydrate-athena.py [--stage dev]
"""

import argparse
import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

PROJECT_ID = "liveops"
REGION = "us-west-2"
DATA_DIR = Path("data/athena-seed-data")

# Map CSV filenames to Athena table names
TABLE_MAP = {
    "kb_players.csv": "players",
    "kb_arena_battles.csv": "arena_battles",
    "kb_campaigns.csv": "campaigns",
    "kb_character_interactions.csv": "character_interactions",
    "kb_daily_activities.csv": "daily_activities",
    "kb_event_participation.csv": "event_participation",
    "kb_gameplay.csv": "gameplay",
    "kb_guild_activities.csv": "guild_activities",
    "kb_incidents.csv": "incidents",
    "kb_monetization_events.csv": "monetization_events",
    "kb_purchases.csv": "purchases",
    "kb_session_details.csv": "session_details",
    "kb_social_interactions.csv": "social_interactions",
    "kb_user_acquisition.csv": "user_acquisition",
}


def find_data_bucket(session, stage):
    """Find the KB data source bucket from the deployed stack."""
    cf = session.client("cloudformation", region_name=REGION)
    stacks = cf.list_stacks(StackStatusFilter=["CREATE_COMPLETE", "UPDATE_COMPLETE"])
    for stack in stacks.get("StackSummaries", []):
        if (
            "backend" in stack["StackName"].lower()
            and stage in stack["StackName"].lower()
        ):
            resources = cf.list_stack_resources(StackName=stack["StackName"])
            for r in resources.get("StackResourceSummaries", []):
                if (
                    r["ResourceType"] == "AWS::S3::Bucket"
                    and "datasource" in r["LogicalResourceId"].lower()
                ):
                    return r["PhysicalResourceId"]
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Hydrate Athena tables with seed CSV data"
    )
    parser.add_argument(
        "--stage", default="dev", help="Deployment stage (default: dev)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be uploaded without uploading",
    )
    args = parser.parse_args()

    print(f"Region: {REGION}\n")

    session = boto3.Session(region_name=REGION)

    # Find the data bucket
    bucket = find_data_bucket(session, args.stage)
    if not bucket:
        print("ERROR: Could not find data source bucket. Is the stack deployed?")
        sys.exit(1)
    print(f"Data bucket: {bucket}\n")

    s3 = session.client("s3", region_name=REGION)
    uploaded = 0
    skipped = 0

    for csv_file, table_name in TABLE_MAP.items():
        local_path = DATA_DIR / csv_file
        if not local_path.exists():
            print(f"  SKIP {csv_file} — file not found")
            skipped += 1
            continue

        s3_key = f"athena/{table_name}/{csv_file}"
        size_kb = local_path.stat().st_size / 1024

        if args.dry_run:
            print(f"  DRY RUN: {csv_file} ({size_kb:.1f} KB) → s3://{bucket}/{s3_key}")
        else:
            try:
                s3.upload_file(str(local_path), bucket, s3_key)
                print(f"  ✓ {csv_file} ({size_kb:.1f} KB) → athena/{table_name}/")
                uploaded += 1
            except ClientError as e:
                print(f"  ✗ {csv_file} — {e}")

    print(f"\nDone. Uploaded: {uploaded}, Skipped: {skipped}")
    if not args.dry_run and uploaded > 0:
        print("\nYou can now query the data:")
        print("  aws athena start-query-execution \\")
        print("    --query-string 'SELECT * FROM liveops.players LIMIT 10' \\")
        print("    --work-group liveops \\")
        print(f"    --region {REGION}")


if __name__ == "__main__":
    main()
