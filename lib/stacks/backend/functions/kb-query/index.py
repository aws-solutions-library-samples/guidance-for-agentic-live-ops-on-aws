# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import os
import boto3
import logging
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda function to query the Bedrock Knowledge Base.
    """

    knowledge_base_id = os.environ["KNOWLEDGE_BASE_ID"]

    try:
        # Parse the request body
        if "body" in event:
            if isinstance(event["body"], str):
                body = json.loads(event["body"])
            else:
                body = event["body"]
        else:
            body = event

        query = body.get("query", "")
        max_results = body.get("maxResults", 5)

        if not query:
            return {
                "statusCode": 400,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type,Authorization",
                    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                },
                "body": json.dumps({"error": "Query parameter is required"}),
            }

        logger.info(f"Querying knowledge base {knowledge_base_id} with query: {query}")

        # Query the knowledge base
        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=knowledge_base_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {"numberOfResults": max_results}
            },
        )

        # Process the results
        results = []
        for result in response.get("retrievalResults", []):
            results.append(
                {
                    "content": result["content"]["text"],
                    "score": result.get("score", 0),
                    "location": result.get("location", {}),
                    "metadata": result.get("metadata", {}),
                }
            )

        logger.info(f"Retrieved {len(results)} results")

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,Authorization",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            },
            "body": json.dumps(
                {"query": query, "results": results, "totalResults": len(results)}
            ),
        }

    except Exception as e:
        logger.error(
            f"Error querying knowledge base: {str(e)}",
            extra={"request_id": context.aws_request_id},
        )
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,Authorization",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            },
            "body": json.dumps(
                {
                    "error": f"Internal server error. Reference ID: {context.aws_request_id}"
                }
            ),
        }
